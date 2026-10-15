import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'data.sqlite');

const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrency
db.exec('PRAGMA journal_mode = WAL;');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS system_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT 'General',
    description TEXT,
    details_json TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS student_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    section TEXT NOT NULL,
    system_id INTEGER,
    system_name TEXT NOT NULL,
    system_category TEXT,
    system_description TEXT,
    seat_number INTEGER,
    seat_column INTEGER,
    seat_row INTEGER,
    seat_label TEXT,
    details_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS disabled_seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT DEFAULT 'GLOBAL',
    seat_number INTEGER NOT NULL,
    reason TEXT DEFAULT 'Unavailable / Broken',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(section, seat_number)
  );
`);

// Add columns if migrating from earlier schema
const tableInfo = db.prepare(`PRAGMA table_info(student_assignments)`).all();
const columnNames = new Set(tableInfo.map(c => c.name));

if (!columnNames.has('seat_number')) {
  db.exec(`ALTER TABLE student_assignments ADD COLUMN seat_number INTEGER;`);
}
if (!columnNames.has('seat_column')) {
  db.exec(`ALTER TABLE student_assignments ADD COLUMN seat_column INTEGER;`);
}
if (!columnNames.has('seat_row')) {
  db.exec(`ALTER TABLE student_assignments ADD COLUMN seat_row INTEGER;`);
}
if (!columnNames.has('seat_label')) {
  db.exec(`ALTER TABLE student_assignments ADD COLUMN seat_label TEXT;`);
}
if (!columnNames.has('details_json')) {
  db.exec(`ALTER TABLE student_assignments ADD COLUMN details_json TEXT;`);
}

const poolTableInfo = db.prepare(`PRAGMA table_info(system_pool)`).all();
const poolColumnNames = new Set(poolTableInfo.map(c => c.name));
if (!poolColumnNames.has('details_json')) {
  db.exec(`ALTER TABLE system_pool ADD COLUMN details_json TEXT;`);
}

// Ensure existing records have clean "Seat #X" labels
db.exec(`
  UPDATE student_assignments 
  SET seat_label = 'Seat #' || seat_number 
  WHERE seat_number IS NOT NULL AND seat_label LIKE 'Col%';
`);

// Create indexes safely
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_assignments_section ON student_assignments(section);
  CREATE INDEX IF NOT EXISTS idx_assignments_student ON student_assignments(student_name);
  CREATE INDEX IF NOT EXISTS idx_assignments_seat ON student_assignments(section, seat_number);
  CREATE INDEX IF NOT EXISTS idx_disabled_seats ON disabled_seats(section, seat_number);
`);

// Helper: Calculate Seat Metadata for 50 Units (Seat 1 to Seat 50)
export function getSeatInfo(seatNumber) {
  if (seatNumber < 1 || seatNumber > 50) return null;
  const label = `Seat #${seatNumber}`;

  return {
    seat_number: seatNumber,
    seat_label: label
  };
}

// Helper: Get adjacent / neighboring seats (Direct Left/Right/Front/Back and Diagonals)
export function getNeighborSeats(seatNumber) {
  if (!seatNumber || seatNumber < 1 || seatNumber > 50) return [];

  const neighbors = [];
  const isLeftWing = seatNumber <= 25;
  const base = isLeftWing ? 1 : 26;
  const offset = seatNumber - base; // 0 to 24 in the 5x5 wing
  const row = Math.floor(offset / 5); // 0 to 4
  const col = offset % 5; // 0 to 4

  // Direct 4-neighbors (Front, Back, Left, Right)
  if (row > 0) neighbors.push(seatNumber - 5); // Front
  if (row < 4) neighbors.push(seatNumber + 5); // Back
  if (col > 0) neighbors.push(seatNumber - 1); // Left
  if (col < 4) neighbors.push(seatNumber + 1); // Right

  // Diagonal 4-neighbors
  if (row > 0 && col > 0) neighbors.push(seatNumber - 6); // Front-Left
  if (row > 0 && col < 4) neighbors.push(seatNumber - 4); // Front-Right
  if (row < 4 && col > 0) neighbors.push(seatNumber + 4); // Back-Left
  if (row < 4 && col < 4) neighbors.push(seatNumber + 6); // Back-Right

  return neighbors;
}

// Helper: Format a clean, structured description from an assessment system object
export function formatSystemDescription(sys) {
  const parts = [];
  
  if (sys.instructions) {
    parts.push(`📋 Instructions:\n${sys.instructions}`);
  }

  if (Array.isArray(sys.required_inputs) && sys.required_inputs.length > 0) {
    parts.push(`⌨️ Required Inputs:\n• ${sys.required_inputs.join('\n• ')}`);
  }

  if (Array.isArray(sys.requirements) && sys.requirements.length > 0) {
    parts.push(`⚙️ Key Requirements:\n• ${sys.requirements.join('\n• ')}`);
  }

  if (Array.isArray(sys.menu_options) && sys.menu_options.length > 0) {
    parts.push(`📑 Menu Options:\n• ${sys.menu_options.join('\n• ')}`);
  }

  if (sys.menu_validation) {
    parts.push(`🛡️ Menu Validation:\n${sys.menu_validation}`);
  }

  if (Array.isArray(sys.required_output) && sys.required_output.length > 0) {
    parts.push(`🖥️ Required Output:\n• ${sys.required_output.join('\n• ')}`);
  }

  return parts.join('\n\n');
}

// Load default 25 assessment systems from assessment_topics.json
let assessmentMeta = {
  schema_version: "1.1",
  title: "Java Fundamentals Practical Assessment - 25 Systems",
  duration_minutes: 60,
  application_type: "Java console application",
  common_requirements: [
    "Every system must accept at least 2 user inputs.",
    "Every system must contain at least 1 loop (for, while, or do-while).",
    "Every system must perform at least 1 calculation or meaningful processing step.",
    "Every system must use at least 1 decision (if/else, if/else-if, or switch).",
    "Use Scanner for keyboard input and System.out for output.",
    "Use appropriate variables and data types.",
    "Display clear prompts and readable results."
  ],
  menu_validation_rules: [
    "Display available menu choices before asking for a selection.",
    "Accept only a choice explicitly listed in the current menu.",
    "If the choice is outside the menu, display an invalid-choice message and ask again.",
    "Do not execute any action for an invalid choice.",
    "Apply validation to the main menu and all submenus."
  ],
  input_validation_rules: [
    "Reject negative values where they are not meaningful.",
    "Reject zero when a positive value is required, such as quantity, duration, height, or question count.",
    "Reject blank names or identifiers where required.",
    "For invalid input, display a helpful message and prompt again."
  ],
  restrictions: [
    "No arrays required",
    "No Java Swing",
    "No JDBC or database",
    "No external libraries",
    "No advanced OOP required"
  ],
  submission_requirements: [
    "Java source file",
    "Screenshot of source code",
    "Screenshot of successful program output"
  ]
};

let assessmentSystems = [];

try {
  const jsonPath = path.join(__dirname, 'assessment_topics.json');
  if (fs.existsSync(jsonPath)) {
    const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (rawData.title) {
      assessmentMeta = {
        schema_version: rawData.schema_version,
        title: rawData.title,
        duration_minutes: rawData.duration_minutes,
        application_type: rawData.application_type,
        common_requirements: rawData.common_requirements,
        menu_validation_rules: rawData.menu_validation_rules,
        input_validation_rules: rawData.input_validation_rules,
        restrictions: rawData.restrictions,
        submission_requirements: rawData.submission_requirements
      };
    }
    assessmentSystems = rawData.systems || [];
  }
} catch (err) {
  console.error('[DB] Error loading assessment_topics.json:', err);
}

const DEFAULT_SYSTEMS = assessmentSystems.map(sys => {
  const detailsObj = {
    ...sys,
    assessment_meta: assessmentMeta
  };
  return {
    id: sys.id,
    name: sys.title,
    category: 'Java Practical Exam',
    description: formatSystemDescription(sys),
    details_json: JSON.stringify(detailsObj)
  };
});

// Seed or synchronize default 25 assessment systems into SQLite
export function syncDefaultSystems(force = false) {
  try {
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM system_pool');
    const count = countStmt.get().count;
    const detailsCountStmt = db.prepare('SELECT COUNT(*) as count FROM system_pool WHERE details_json IS NOT NULL');
    const detailsCount = detailsCountStmt.get().count;

    if (force || count === 0 || detailsCount < DEFAULT_SYSTEMS.length) {
      console.log(`[DB] Syncing system pool with ${DEFAULT_SYSTEMS.length} Java Practical Assessment systems...`);
      const upsertStmt = db.prepare(`
        INSERT INTO system_pool (name, category, description, is_active, details_json)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(name) DO UPDATE SET 
          category = excluded.category,
          description = excluded.description,
          details_json = excluded.details_json,
          is_active = 1
      `);

      for (const sys of DEFAULT_SYSTEMS) {
        upsertStmt.run(sys.name, sys.category, sys.description, sys.details_json);
      }
      console.log(`[DB] Synced ${DEFAULT_SYSTEMS.length} systems successfully.`);
    }
  } catch (e) {
    console.error('[DB] Error syncing default systems:', e);
  }
}

// Initial sync on startup
syncDefaultSystems();

export default db;
export { DEFAULT_SYSTEMS, assessmentMeta };
