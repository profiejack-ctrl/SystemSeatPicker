# 🎲 Student Random System & Seat Picker (Node.js + SQLite)

A web application designed for instructors, professors, and lab administrators to:
1. **Randomly assign software/project topics** per student from a customizable topic pool.
2. **Randomly assign a Seat Number (Seats 1 – 50)** per student in each section.
3. **🚫 Remove / Disable Unavailable Seats**: Easily remove broken PCs, reserved units, or damaged chairs so the random picker automatically skips them.
4. **🛡️ Adjacent / Nearby Seat Restriction (Anti-Cheating)**: Automatically prevents students in adjacent/nearby seats (Front, Back, Left, Right, Diagonals) from receiving the same project!
5. **Persist all records into a local SQLite database** (`data.sqlite`).
6. **Filter by Section**, search, view an **interactive visual 50 Seats Map with Center Aisle**, and **Export to CSV** or Print.

---

## 🚫 How to Remove / Disable Unavailable Seats

There are two quick ways to remove unavailable seats:

### Method 1: Click Any Seat on the 50 Seats Map
1. Click **"Show 50 Seats Map"** in the top header.
2. Click directly on any seat (e.g., `Seat 5` or `Seat 12`).
3. Click **"🚫 Mark as Unavailable / Broken"** (you can optionally type a reason such as *"Broken Monitor"* or *"No Power"*).
4. The seat turns **Red / Striped 🚫** and the random generator will immediately skip it!
5. To restore the seat later, click it again and choose **"✅ Restore to Available"**.

### Method 2: Batch Manage Unavailable Seats
1. On the 50 Seats Map, click the **"🚫 Manage Unavailable Seats"** button.
2. Enter multiple seat numbers separated by commas (e.g., `5, 8, 12, 23`).
3. Click **"Mark Seats Unavailable"**.
4. You can also view all currently disabled seats and restore them individually or with **"Restore All Seats"**.

---

## 🪑 50 Seats Map with Center Aisle

The 50-seat computer laboratory is organized with a **Center Aisle**:

```
     [ LEFT WING ]            |   CENTER   |          [ RIGHT WING ]
  Seats 01 – 25 (5x5 Grid)    |   AISLE    |      Seats 26 – 50 (5x5 Grid)
```

- **Green**: Available for assignment
- **Blue**: Occupied by a student
- **Red Striped (🚫)**: Unavailable / Out of order (skipped by picker)

---

## 🏷️ Section Presets
- `BSIT - 21001`
- `BSIT - 21002`
- `BSIT - 21003`
- `BSIT - 21007`
- `BSIT - 21008`
- `BSIT - 21009`

---

## 🚀 How to Run the App

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
or
```bash
node server.js
```

### 3. Open in Browser
Visit: **[http://localhost:3000](http://localhost:3000)**
