import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db, { DEFAULT_SYSTEMS, getSeatInfo, getNeighborSeats } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Get Set of disabled seat numbers for a section
function getDisabledSeatsSet(section) {
  const query = `
    SELECT seat_number FROM disabled_seats 
    WHERE section = 'GLOBAL' OR LOWER(section) = LOWER(?)
  `;
  const rows = db.prepare(query).all(section || '');
  return new Set(rows.map(r => r.seat_number));
}

// ==========================================
// API ROUTES
// ==========================================

// 1. Pick a random system & seat with adjacent restriction and skipping unavailable seats
app.post('/api/pick-system', (req, res) => {
  try {
    const { 
      studentName, 
      section, 
      avoidDuplicateInSection = false, 
      avoidAdjacentDuplicate = true,
      allowReRoll = false,
      assignSeat = true,
      preferredSeatNumber = null
    } = req.body;

    if (!studentName || !studentName.trim()) {
      return res.status(400).json({ error: 'Student Name is required.' });
    }
    if (!section || !section.trim()) {
      return res.status(400).json({ error: 'Section is required.' });
    }

    const trimmedName = studentName.trim();
    const trimmedSection = section.trim();

    // Check if student already has a record in this section
    const existingStmt = db.prepare(`
      SELECT * FROM student_assignments 
      WHERE LOWER(student_name) = LOWER(?) AND LOWER(section) = LOWER(?)
    `);
    const existingRecord = existingStmt.get(trimmedName, trimmedSection);

    if (existingRecord && !allowReRoll) {
      return res.status(409).json({
        error: 'Student already has an assigned system and seat in this section.',
        alreadyAssigned: true,
        assignment: existingRecord
      });
    }

    // Step 1: Pick Seat Number (Skipping Occupied and Unavailable/Disabled Seats)
    let chosenSeatInfo = null;
    let chosenSeatNum = null;

    if (assignSeat) {
      // 1. Occupied seats
      const occupiedRows = db.prepare(`
        SELECT seat_number FROM student_assignments 
        WHERE LOWER(section) = LOWER(?) AND seat_number IS NOT NULL
        ${existingRecord ? 'AND id != ' + existingRecord.id : ''}
      `).all(trimmedSection);
      const occupiedSeatNumbers = new Set(occupiedRows.map(r => r.seat_number));

      // 2. Disabled/Unavailable seats
      const disabledSeatNumbers = getDisabledSeatsSet(trimmedSection);

      if (preferredSeatNumber && preferredSeatNumber >= 1 && preferredSeatNumber <= 50) {
        if (disabledSeatNumbers.has(preferredSeatNumber)) {
          return res.status(400).json({ error: `Seat #${preferredSeatNumber} is marked as unavailable / out of order.` });
        }
        if (occupiedSeatNumbers.has(preferredSeatNumber)) {
          return res.status(400).json({ error: `Seat #${preferredSeatNumber} is already occupied by another student.` });
        }
        chosenSeatNum = preferredSeatNumber;
        chosenSeatInfo = getSeatInfo(chosenSeatNum);
      } else {
        const availableSeats = [];
        for (let s = 1; s <= 50; s++) {
          if (!occupiedSeatNumbers.has(s) && !disabledSeatNumbers.has(s)) {
            availableSeats.push(s);
          }
        }

        if (availableSeats.length > 0) {
          chosenSeatNum = availableSeats[Math.floor(Math.random() * availableSeats.length)];
          chosenSeatInfo = getSeatInfo(chosenSeatNum);
        } else {
          chosenSeatInfo = {
            seat_number: null,
            seat_label: 'No Seats Available'
          };
        }
      }
    }

    // Step 2: Query Active Systems from Pool
    let candidateSystems = db.prepare('SELECT * FROM system_pool WHERE is_active = 1').all();
    if (!candidateSystems || candidateSystems.length === 0) {
      return res.status(500).json({ error: 'No active systems available in the pool. Please add systems or reset the pool.' });
    }

    let avoidedNeighbors = [];
    let avoidedNeighborSystems = [];

    // Step 3: Adjacent / Nearby Seat Restriction (Anti-cheating)
    if (chosenSeatNum && avoidAdjacentDuplicate) {
      const neighborSeatNums = getNeighborSeats(chosenSeatNum);
      avoidedNeighbors = neighborSeatNums;

      if (neighborSeatNums.length > 0) {
        const placeholders = neighborSeatNums.map(() => '?').join(',');
        const neighborAssignments = db.prepare(`
          SELECT seat_number, system_id, system_name 
          FROM student_assignments 
          WHERE LOWER(section) = LOWER(?) AND seat_number IN (${placeholders})
          ${existingRecord ? 'AND id != ' + existingRecord.id : ''}
        `).all(trimmedSection, ...neighborSeatNums);

        if (neighborAssignments.length > 0) {
          const neighborSystemIds = new Set(neighborAssignments.map(a => a.system_id));
          const neighborSystemNames = new Set(neighborAssignments.map(a => a.system_name.toLowerCase()));
          avoidedNeighborSystems = neighborAssignments.map(a => `Seat #${a.seat_number} (${a.system_name})`);

          const nonAdjacentSystems = candidateSystems.filter(s => 
            !neighborSystemIds.has(s.id) && !neighborSystemNames.has(s.name.toLowerCase())
          );

          if (nonAdjacentSystems.length > 0) {
            candidateSystems = nonAdjacentSystems;
          }
        }
      }
    }

    // Step 4: Avoid entire section duplicate (if enabled)
    if (avoidDuplicateInSection) {
      const sectionAssignments = db.prepare(`
        SELECT system_id, system_name FROM student_assignments 
        WHERE LOWER(section) = LOWER(?)
        ${existingRecord ? 'AND id != ' + existingRecord.id : ''}
      `).all(trimmedSection);

      const sectionSysIds = new Set(sectionAssignments.map(s => s.system_id));
      const sectionSysNames = new Set(sectionAssignments.map(s => s.system_name.toLowerCase()));

      const unpickedInSection = candidateSystems.filter(s => 
        !sectionSysIds.has(s.id) && !sectionSysNames.has(s.name.toLowerCase())
      );

      if (unpickedInSection.length > 0) {
        candidateSystems = unpickedInSection;
      }
    }

    // Step 5: Pick random system from candidate pool
    const randomSysIndex = Math.floor(Math.random() * candidateSystems.length);
    const chosenSystem = candidateSystems[randomSysIndex];

    let assignmentId;
    if (existingRecord && allowReRoll) {
      const updateStmt = db.prepare(`
        UPDATE student_assignments 
        SET system_id = ?, system_name = ?, system_category = ?, system_description = ?, 
            seat_number = ?, seat_label = ?, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStmt.run(
        chosenSystem.id, 
        chosenSystem.name, 
        chosenSystem.category, 
        chosenSystem.description,
        chosenSeatInfo?.seat_number || null,
        chosenSeatInfo?.seat_label || null,
        existingRecord.id
      );
      assignmentId = existingRecord.id;
    } else {
      const insertStmt = db.prepare(`
        INSERT INTO student_assignments (
          student_name, section, system_id, system_name, system_category, system_description,
          seat_number, seat_label
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = insertStmt.run(
        trimmedName,
        trimmedSection,
        chosenSystem.id,
        chosenSystem.name,
        chosenSystem.category,
        chosenSystem.description,
        chosenSeatInfo?.seat_number || null,
        chosenSeatInfo?.seat_label || null
      );
      assignmentId = result.lastInsertRowid;
    }

    const savedAssignment = db.prepare('SELECT * FROM student_assignments WHERE id = ?').get(assignmentId);

    return res.status(200).json({
      success: true,
      message: 'System and Seat picked successfully!',
      assignment: savedAssignment,
      seatInfo: chosenSeatInfo,
      adjacentRestricted: avoidedNeighborSystems.length > 0,
      avoidedNeighborSystems,
      totalInPool: candidateSystems.length
    });
  } catch (err) {
    console.error('Error in /api/pick-system:', err);
    return res.status(500).json({ error: 'Failed to process request: ' + err.message });
  }
});

// 2. Get 50 Seats Map (Seats 1 - 50) including Occupied and Unavailable Seats
app.get('/api/seats', (req, res) => {
  try {
    const { section } = req.query;
    const targetSection = (section && section !== 'ALL') ? section.trim() : 'ALL';

    // Query Occupied Seats
    let assignments = [];
    if (targetSection !== 'ALL') {
      assignments = db.prepare(`
        SELECT id, student_name, section, system_name, system_category, system_description, seat_number, seat_label, created_at
        FROM student_assignments
        WHERE LOWER(section) = LOWER(?) AND seat_number IS NOT NULL
      `).all(targetSection);
    } else {
      assignments = db.prepare(`
        SELECT id, student_name, section, system_name, system_category, system_description, seat_number, seat_label, created_at
        FROM student_assignments
        WHERE seat_number IS NOT NULL
      `).all();
    }

    const occupiedMap = new Map();
    assignments.forEach(a => {
      occupiedMap.set(a.seat_number, a);
    });

    // Query Disabled / Unavailable Seats
    let disabledRows = [];
    if (targetSection !== 'ALL') {
      disabledRows = db.prepare(`
        SELECT seat_number, reason, section FROM disabled_seats 
        WHERE section = 'GLOBAL' OR LOWER(section) = LOWER(?)
      `).all(targetSection);
    } else {
      disabledRows = db.prepare(`
        SELECT seat_number, reason, section FROM disabled_seats
      `).all();
    }

    const disabledMap = new Map();
    disabledRows.forEach(d => {
      disabledMap.set(d.seat_number, d);
    });

    const seats = [];
    let unavailableCount = 0;
    let occupiedCount = 0;

    for (let i = 1; i <= 50; i++) {
      const meta = getSeatInfo(i);
      const student = occupiedMap.get(i) || null;
      const disabledInfo = disabledMap.get(i) || null;
      const neighborSeats = getNeighborSeats(i);

      const isUnavailable = !!disabledInfo;
      const isOccupied = !!student && !isUnavailable;

      if (isUnavailable) unavailableCount++;
      if (isOccupied) occupiedCount++;

      seats.push({
        ...meta,
        is_occupied: isOccupied,
        is_unavailable: isUnavailable,
        unavailable_reason: disabledInfo ? disabledInfo.reason : null,
        occupant: student,
        neighbors: neighborSeats
      });
    }

    const availableCount = 50 - occupiedCount - unavailableCount;

    return res.json({
      section: targetSection,
      totalUnits: 50,
      occupiedCount,
      unavailableCount,
      availableCount: Math.max(0, availableCount),
      seats
    });
  } catch (err) {
    console.error('Error in /api/seats:', err);
    return res.status(500).json({ error: 'Failed to fetch seats map.' });
  }
});

// 3. Toggle Seat Unavailable Status
app.post('/api/seats/toggle-unavailable', (req, res) => {
  try {
    const { seatNumber, section = 'GLOBAL', isUnavailable = true, reason = 'Unavailable / Broken' } = req.body;

    if (!seatNumber || seatNumber < 1 || seatNumber > 50) {
      return res.status(400).json({ error: 'Valid seat number (1-50) is required.' });
    }

    const targetSection = section.trim() || 'GLOBAL';

    if (isUnavailable) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO disabled_seats (section, seat_number, reason)
        VALUES (?, ?, ?)
      `);
      stmt.run(targetSection, seatNumber, reason);
    } else {
      const stmt = db.prepare(`
        DELETE FROM disabled_seats 
        WHERE seat_number = ? AND (section = ? OR section = 'GLOBAL' OR LOWER(section) = LOWER(?))
      `);
      stmt.run(seatNumber, targetSection, targetSection);
    }

    return res.json({ 
      success: true, 
      message: isUnavailable ? `Seat #${seatNumber} marked as unavailable.` : `Seat #${seatNumber} restored to available.`,
      seatNumber,
      isUnavailable
    });
  } catch (err) {
    console.error('Error toggling seat unavailable:', err);
    return res.status(500).json({ error: 'Failed to update seat status: ' + err.message });
  }
});

// 4. Batch Toggle Unavailable Seats
app.post('/api/seats/batch-unavailable', (req, res) => {
  try {
    const { seatNumbers = [], section = 'GLOBAL', isUnavailable = true, reason = 'Unavailable / Broken' } = req.body;
    const targetSection = section.trim() || 'GLOBAL';

    if (isUnavailable) {
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO disabled_seats (section, seat_number, reason)
        VALUES (?, ?, ?)
      `);
      for (const s of seatNumbers) {
        if (s >= 1 && s <= 50) {
          insertStmt.run(targetSection, s, reason);
        }
      }
    } else {
      const deleteStmt = db.prepare(`
        DELETE FROM disabled_seats 
        WHERE seat_number = ? AND (section = ? OR section = 'GLOBAL' OR LOWER(section) = LOWER(?))
      `);
      for (const s of seatNumbers) {
        deleteStmt.run(s, targetSection, targetSection);
      }
    }

    return res.json({ success: true, count: seatNumbers.length });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to batch update seats: ' + err.message });
  }
});

// 5. Reset All Unavailable Seats
app.post('/api/seats/reset-unavailable', (req, res) => {
  try {
    const { section = 'GLOBAL' } = req.body;
    if (section === 'GLOBAL' || section === 'ALL') {
      db.exec('DELETE FROM disabled_seats');
    } else {
      const stmt = db.prepare('DELETE FROM disabled_seats WHERE LOWER(section) = LOWER(?) OR section = "GLOBAL"');
      stmt.run(section);
    }
    return res.json({ success: true, message: 'All seats restored to available.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset unavailable seats.' });
  }
});

// 6. Get list of student assignments
app.get('/api/assignments', (req, res) => {
  try {
    const { section, search } = req.query;

    let query = 'SELECT * FROM student_assignments WHERE 1=1';
    const params = [];

    if (section && section !== 'ALL') {
      query += ' AND LOWER(section) = LOWER(?)';
      params.push(section);
    }

    if (search && search.trim()) {
      query += ' AND (LOWER(student_name) LIKE LOWER(?) OR LOWER(system_name) LIKE LOWER(?) OR LOWER(section) LIKE LOWER(?) OR LOWER(seat_label) LIKE LOWER(?))';
      const searchPattern = `%${search.trim()}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += ' ORDER BY created_at DESC, id DESC';

    const assignments = db.prepare(query).all(...params);
    return res.json({ assignments });
  } catch (err) {
    console.error('Error in /api/assignments:', err);
    return res.status(500).json({ error: 'Failed to fetch assignments.' });
  }
});

// 7. Get single assignment details
app.get('/api/assignments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const assignment = db.prepare('SELECT * FROM student_assignments WHERE id = ?').get(id);
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment record not found.' });
    }
    return res.json({ assignment });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch assignment details.' });
  }
});

// 8. Delete single assignment
app.delete('/api/assignments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('DELETE FROM student_assignments WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    return res.json({ success: true, message: 'Record deleted successfully.' });
  } catch (err) {
    console.error('Error deleting assignment:', err);
    return res.status(500).json({ error: 'Failed to delete record.' });
  }
});

// 9. Clear assignments
app.delete('/api/assignments', (req, res) => {
  try {
    const { section } = req.query;
    let result;
    if (section && section !== 'ALL') {
      const stmt = db.prepare('DELETE FROM student_assignments WHERE LOWER(section) = LOWER(?)');
      result = stmt.run(section);
    } else {
      const stmt = db.prepare('DELETE FROM student_assignments');
      result = stmt.run();
    }
    return res.json({ success: true, deletedCount: result.changes });
  } catch (err) {
    console.error('Error clearing assignments:', err);
    return res.status(500).json({ error: 'Failed to clear assignments.' });
  }
});

// 10. Get distinct sections list with student counts
app.get('/api/sections', (req, res) => {
  try {
    const sections = db.prepare(`
      SELECT section, COUNT(*) as student_count 
      FROM student_assignments 
      GROUP BY section 
      ORDER BY section ASC
    `).all();

    const totalStudents = db.prepare('SELECT COUNT(*) as count FROM student_assignments').get().count;
    const totalPool = db.prepare('SELECT COUNT(*) as count FROM system_pool WHERE is_active = 1').get().count;
    const totalDisabled = db.prepare('SELECT COUNT(*) as count FROM disabled_seats').get().count;

    return res.json({ sections, totalStudents, totalPool, totalDisabled, maxLabSeats: 50 });
  } catch (err) {
    console.error('Error fetching sections:', err);
    return res.status(500).json({ error: 'Failed to fetch sections.' });
  }
});

// 11. Get system pool list
app.get('/api/systems-pool', (req, res) => {
  try {
    const systems = db.prepare(`
      SELECT sp.*, 
        (SELECT COUNT(*) FROM student_assignments sa WHERE sa.system_id = sp.id) as pick_count
      FROM system_pool sp 
      ORDER BY sp.name ASC
    `).all();
    return res.json({ systems });
  } catch (err) {
    console.error('Error fetching system pool:', err);
    return res.status(500).json({ error: 'Failed to fetch systems pool.' });
  }
});

// 12. Get single system details
app.get('/api/systems-pool/:id', (req, res) => {
  try {
    const { id } = req.params;
    const system = db.prepare('SELECT * FROM system_pool WHERE id = ?').get(id);
    if (!system) {
      return res.status(404).json({ error: 'System not found.' });
    }
    return res.json({ system });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch system details.' });
  }
});

// 13. Add new system to pool
app.post('/api/systems-pool', (req, res) => {
  try {
    const { name, category = 'General', description = '' } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'System name is required.' });
    }

    const stmt = db.prepare(`
      INSERT INTO system_pool (name, category, description, is_active)
      VALUES (?, ?, ?, 1)
    `);
    const result = stmt.run(name.trim(), category.trim() || 'General', description.trim());
    return res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'A system with this name already exists in the pool.' });
    }
    return res.status(500).json({ error: 'Failed to add system: ' + err.message });
  }
});

// 14. Bulk Import Topics (JSON / Parsed MD)
app.post('/api/systems-pool/import', (req, res) => {
  try {
    const { topics = [], mode = 'append' } = req.body;

    if (!Array.isArray(topics) || topics.length === 0) {
      return res.status(400).json({ error: 'No valid topics provided for import.' });
    }

    if (mode === 'replace') {
      db.exec('DELETE FROM system_pool');
    }

    const insertStmt = db.prepare(`
      INSERT INTO system_pool (name, category, description, is_active)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(name) DO UPDATE SET 
        category = excluded.category,
        description = excluded.description
    `);

    let importedCount = 0;
    for (const t of topics) {
      const name = (typeof t === 'string' ? t : t.name || '').trim();
      const category = (t.category || 'General').trim();
      const description = (t.description || '').trim();

      if (name) {
        insertStmt.run(name, category, description);
        importedCount++;
      }
    }

    const newTotal = db.prepare('SELECT COUNT(*) as count FROM system_pool WHERE is_active = 1').get().count;

    return res.json({
      success: true,
      message: `Successfully imported ${importedCount} topics into pool!`,
      importedCount,
      totalPool: newTotal
    });
  } catch (err) {
    console.error('Error importing topics:', err);
    return res.status(500).json({ error: 'Failed to import topics: ' + err.message });
  }
});

// 15. Export Topics (JSON or Markdown)
app.get('/api/systems-pool/export/:format', (req, res) => {
  try {
    const { format } = req.params;
    const systems = db.prepare('SELECT name, category, description FROM system_pool WHERE is_active = 1 ORDER BY name ASC').all();

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="system_topics.json"');
      return res.send(JSON.stringify(systems, null, 2));
    } else if (format === 'md') {
      let md = '# 📚 System Project Topics Pool\n\n';
      md += `Total Topics: ${systems.length}\n\n`;
      md += '| # | System Name | Category | Description / Scope |\n';
      md += '|---|-------------|----------|---------------------|\n';
      systems.forEach((s, idx) => {
        const cleanName = (s.name || '').replace(/\|/g, '-');
        const cleanCat = (s.category || 'General').replace(/\|/g, '-');
        const cleanDesc = (s.description || '').replace(/\|/g, '-').replace(/\r?\n/g, ' ');
        md += `| ${idx + 1} | **${cleanName}** | ${cleanCat} | ${cleanDesc} |\n`;
      });

      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', 'attachment; filename="system_topics.md"');
      return res.send(md);
    } else {
      return res.status(400).send('Supported formats: json, md');
    }
  } catch (err) {
    return res.status(500).send('Error exporting topics: ' + err.message);
  }
});

// 16. Delete system from pool
app.delete('/api/systems-pool/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('DELETE FROM system_pool WHERE id = ?');
    stmt.run(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete system.' });
  }
});

// 17. Reset pool to default systems
app.post('/api/systems-pool/reset', (req, res) => {
  try {
    db.exec('DELETE FROM system_pool');
    const insertStmt = db.prepare(`
      INSERT INTO system_pool (name, category, description, is_active)
      VALUES (?, ?, ?, 1)
    `);
    for (const sys of DEFAULT_SYSTEMS) {
      insertStmt.run(sys.name, sys.category, sys.description);
    }
    return res.json({ success: true, count: DEFAULT_SYSTEMS.length });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset pool: ' + err.message });
  }
});

// 18. Export Student Assignments CSV
app.get('/api/export/csv', (req, res) => {
  try {
    const { section } = req.query;
    let query = 'SELECT * FROM student_assignments';
    const params = [];
    if (section && section !== 'ALL') {
      query += ' WHERE LOWER(section) = LOWER(?)';
      params.push(section);
    }
    query += ' ORDER BY section ASC, seat_number ASC, student_name ASC';

    const records = db.prepare(query).all(...params);

    let csv = 'ID,Student Name,Section,Seat Number,Assigned System,Category,Description,Date & Time Picked\r\n';
    for (const r of records) {
      const escape = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;
      const seatText = r.seat_number ? `Seat #${r.seat_number}` : 'Unassigned';
      csv += `${r.id},${escape(r.student_name)},${escape(r.section)},${escape(seatText)},${escape(r.system_name)},${escape(r.system_category)},${escape(r.system_description)},${escape(r.created_at)}\r\n`;
    }

    const filename = `student_system_and_seats_${section ? section.replace(/[^a-zA-Z0-9]/g, '_') : 'all'}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).send('Error generating CSV');
  }
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🎯 Random System & Seat Picker Web App running!`);
  console.log(`👉 Open your browser at: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
