import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
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

// Ensure existing records have clean "Seat #X" labels
db.exec(`
  UPDATE student_assignments 
  SET seat_label = 'Seat #' || seat_number 
  WHERE seat_number IS NOT NULL AND seat_label LIKE 'Col%';
`);

// Now create indexes safely
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

// Default Pool of Systems: Java Fundamentals Practical Assessment (25 Systems)
const DEFAULT_SYSTEMS = [
  {
    name: 'Student Grade Calculator',
    category: 'Java Practical Exam',
    description: 'Accept student information and grades, calculate the average, and determine PASS or FAIL.\n\n📌 Requirements:\n• Accept at least 2 appropriate user inputs\n• Perform at least 1 required calculation\n• Use at least 1 decision using if/else or switch\n• Use at least 1 loop\n• Use Scanner for input & System.out for output\n\n🖥️ Required Output:\n• Display student details and calculated average\n• Display PASS / FAIL status remark\n• Provide an option to repeat for another student'
  },
  {
    name: 'Simple Payroll System',
    category: 'Java Practical Exam',
    description: 'Calculate employee gross pay based on hours worked, hourly rate, and overtime.\n\n📌 Requirements:\n• Accept hours worked and hourly rate\n• Calculate regular pay and overtime pay\n• Use decision structures for overtime condition\n• Loop to calculate multiple employee payrolls\n\n🖥️ Required Output:\n• Display gross salary, deductions, and net pay\n• Option to process another employee'
  },
  {
    name: 'Electricity Bill Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate an electricity bill based on kWh consumption and applicable rate tier.\n\n📌 Requirements:\n• Input customer name and kWh consumed\n• Calculate tiered consumption rate & surcharge\n• Decision logic for different kWh consumption tiers\n\n🖥️ Required Output:\n• Itemized power bill with total amount due\n• Option to calculate another bill'
  },
  {
    name: 'Water Bill Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate a water bill based on cubic meter consumption and applicable charge.\n\n📌 Requirements:\n• Input cubic meters used and customer type (residential/commercial)\n• Calculate base fee and consumption rate with if/else\n• Use loop to repeat billing calculations'
  },
  {
    name: 'Grocery Checkout System',
    category: 'Java Practical Exam',
    description: 'Calculate item subtotals, total purchase, discount, and final amount.\n\n📌 Requirements:\n• Accept item price, quantity, and customer senior/member discount\n• Calculate subtotal, discount amount, and cash change\n• Loop through multiple item purchases'
  },
  {
    name: 'Bus Fare Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate passenger fare based on passenger type (regular/student/senior) and travel distance.\n\n📌 Requirements:\n• Input passenger classification and kilometers travelled\n• Apply 20% discount for student/senior with decision statement\n• Calculate total fare with loop option'
  },
  {
    name: 'Parking Fee Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate parking fees based on the number of hours parked and vehicle type (motorcycle/car/truck).\n\n📌 Requirements:\n• Input vehicle type and total hours\n• First 2 hours base rate + hourly excess rate calculation\n• Loop for multiple parking ticket entries'
  },
  {
    name: 'Restaurant Ordering System',
    category: 'Java Practical Exam',
    description: 'Calculate the total cost of selected food items and applicable discount.\n\n📌 Requirements:\n• Display menu with numbered choices using switch/case\n• Accept item quantity and compute total bill\n• Loop for adding more items to the order'
  },
  {
    name: 'Cinema Ticket System',
    category: 'Java Practical Exam',
    description: 'Calculate total cinema ticket cost based on ticket type (2D/3D/IMAX) and quantity.\n\n📌 Requirements:\n• Input movie screening type and number of tickets\n• Apply matinee or senior discount via conditional check\n• Loop for multiple customer transactions'
  },
  {
    name: 'Hotel Billing System',
    category: 'Java Practical Exam',
    description: 'Calculate a guest room bill based on room type (Standard/Deluxe/Suite) and number of nights.\n\n📌 Requirements:\n• Input room choice and duration of stay\n• Calculate room total, service charge, and taxes\n• Loop for processing checkouts'
  },
  {
    name: 'Mobile Load Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate the total cost of selected mobile load packages and airtime credits.\n\n📌 Requirements:\n• Input mobile number and load promo code / amount\n• Validate payment cash tendered and compute change\n• Loop to process another transaction'
  },
  {
    name: 'Simple Inventory Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate product inventory value and determine stock status (Low/Adequate/Overstocked).\n\n📌 Requirements:\n• Input product name, unit cost, and stock quantity\n• Calculate total inventory asset value\n• Determine reorder warning with if/else'
  },
  {
    name: 'Quiz Score Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate quiz percentage and determine the student remarks (Excellent/Good/Needs Improvement).\n\n📌 Requirements:\n• Input total items and correct answers\n• Calculate score percentage (Score / Total * 100)\n• Output descriptive letter grade or remark'
  },
  {
    name: 'ATM Withdrawal Simulation',
    category: 'Java Practical Exam',
    description: 'Simulate balance checking and withdrawal with transaction validation.\n\n📌 Requirements:\n• Input initial balance, PIN validation, and withdrawal amount\n• Check for sufficient funds using if/else\n• Loop allowing multiple ATM transactions until Exit'
  },
  {
    name: 'Sales Commission Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate salesperson commission based on total monthly sales bracket.\n\n📌 Requirements:\n• Input agent name and gross sales volume\n• Multi-tier commission percentage using if-else if\n• Loop to evaluate sales agents'
  },
  {
    name: 'Temperature Converter',
    category: 'Java Practical Exam',
    description: 'Convert Celsius / Fahrenheit values and display weather advice.\n\n📌 Requirements:\n• Input temperature value and conversion mode (C to F or F to C)\n• Perform mathematical conversion formula\n• Decision structure for hot / warm / cold warning'
  },
  {
    name: 'BMI Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate Body Mass Index (BMI) and determine corresponding health category.\n\n📌 Requirements:\n• Input weight (kg) and height (meters)\n• Compute BMI = weight / (height * height)\n• Classify Underweight / Normal / Overweight / Obese'
  },
  {
    name: 'Salary Deduction Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate mandatory contributions (SSS, PhilHealth, Pag-IBIG, Tax) and net take-home pay.\n\n📌 Requirements:\n• Input basic monthly salary\n• Calculate percentage deductions and total tax\n• Display itemized payslip breakdown'
  },
  {
    name: 'Discount Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate promotional discount and final payable price based on purchase tiers.\n\n📌 Requirements:\n• Input original item price and promo voucher\n• Apply 10%/20%/30% discount bracket\n• Display savings and final checkout price'
  },
  {
    name: 'Driving Speed Checker',
    category: 'Java Practical Exam',
    description: 'Check whether a vehicle exceeds the speed limit and calculate the overspeeding penalty fee.\n\n📌 Requirements:\n• Input detected speed (km/h) and zone speed limit\n• Evaluate speed difference with if/else\n• Issue fine ticket or safe driving confirmation'
  },
  {
    name: 'Age Category System',
    category: 'Java Practical Exam',
    description: 'Determine a person age group (Infant, Child, Teenager, Adult, Senior) and eligibility.\n\n📌 Requirements:\n• Input birth year or age\n• Nested if/else decision logic\n• Output age group and voting / driving eligibility'
  },
  {
    name: 'Leap Year Checker',
    category: 'Java Practical Exam',
    description: 'Determine whether a given calendar year is a Leap Year using modulus operators.\n\n📌 Requirements:\n• Input year integer\n• Divisibility check: (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)\n• Loop to test multiple years'
  },
  {
    name: 'Number Analyzer',
    category: 'Java Practical Exam',
    description: 'Accept multiple integer inputs, compute their sum, average, and identify highest & lowest numbers.\n\n📌 Requirements:\n• Loop to accept N numbers from user\n• Accumulator calculation for sum and average\n• Min/Max comparison tracking'
  },
  {
    name: 'Simple Unit Converter',
    category: 'Java Practical Exam',
    description: 'Convert values between units of measurement (Length: KM to Miles, Weight: KG to Lbs).\n\n📌 Requirements:\n• Menu selection using switch/case\n• Convert user input with conversion multiplier\n• Option to perform another conversion'
  },
  {
    name: 'Loan Payment Calculator',
    category: 'Java Practical Exam',
    description: 'Calculate loan interest, total repayable amount, and monthly amortization installment.\n\n📌 Requirements:\n• Input principal loan amount, annual interest rate, and loan term in months\n• Calculate simple or compound interest\n• Output monthly installment payment'
  }
];

// Seed default systems if pool is empty
const countStmt = db.prepare('SELECT COUNT(*) as count FROM system_pool');
const countResult = countStmt.get();
if (countResult.count === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO system_pool (name, category, description, is_active)
    VALUES (?, ?, ?, 1)
  `);
  for (const sys of DEFAULT_SYSTEMS) {
    insertStmt.run(sys.name, sys.category, sys.description);
  }
  console.log(`[DB] Initialized system pool with ${DEFAULT_SYSTEMS.length} default systems.`);
}

export default db;
export { DEFAULT_SYSTEMS };
