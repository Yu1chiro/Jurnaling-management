require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const pg = require("pg");
const xlsx = require("xlsx");

const app = express();
const port = 3000;

// Konfigurasi koneksi database dari .env
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Middleware untuk proteksi halaman
const authMiddleware = (req, res, next) => {
  const { token } = req.cookies;
  if (token && token === "admin-authenticated") {
    next();
  } else {
    res.redirect("/");
  }
};

// Fungsi untuk inisialisasi database
const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
            CREATE TABLE IF NOT EXISTS classes ( id SERIAL PRIMARY KEY, class_name VARCHAR(50) UNIQUE NOT NULL, homeroom_teacher VARCHAR(100) );
            CREATE TABLE IF NOT EXISTS students ( id SERIAL PRIMARY KEY, nipd VARCHAR(20) UNIQUE NOT NULL, full_name VARCHAR(100) NOT NULL, gender CHAR(1), class_id INT REFERENCES classes(id) ON DELETE CASCADE, grade INT DEFAULT 0 );
            CREATE TABLE IF NOT EXISTS student_status ( id SERIAL PRIMARY KEY, student_id INT REFERENCES students(id) ON DELETE CASCADE, status_date DATE NOT NULL, status VARCHAR(10) DEFAULT 'Hadir', UNIQUE (student_id, status_date) );
            CREATE TABLE IF NOT EXISTS student_notes ( id SERIAL PRIMARY KEY, student_id INT REFERENCES students(id) ON DELETE CASCADE, note_date TIMESTAMPTZ DEFAULT NOW(), note_text TEXT NOT NULL );
            CREATE TABLE IF NOT EXISTS class_journals ( id SERIAL PRIMARY KEY, class_id INT REFERENCES classes(id) ON DELETE CASCADE NOT NULL, journal_date DATE NOT NULL DEFAULT CURRENT_DATE, learning_achievement TEXT, material_element TEXT, agenda TEXT, method TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
        `);

    await client.query("COMMIT");
    console.log("Database schema is ready. No default data was seeded.");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Database initialization failed:", e);
  } finally {
    client.release();
  }
};

// --- Rute Halaman ---
app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/dashboard", authMiddleware, (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/jurnal-kelas", authMiddleware, (req, res) => res.sendFile(path.join(__dirname, "public", "jurnal-kelas.html")));

// --- Rute API Otentikasi ---
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    res.cookie("token", "admin-authenticated", { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: "Username atau password salah." });
  }
});
app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// --- API CRUD untuk Kelas ---
app.get("/api/classes", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, class_name, homeroom_teacher FROM classes ORDER BY class_name");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});
app.post("/api/classes", authMiddleware, async (req, res) => {
  const { className, homeroomTeacher } = req.body;
  try {
    const result = await pool.query("INSERT INTO classes (class_name, homeroom_teacher) VALUES ($1, $2) RETURNING *", [className, homeroomTeacher]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Gagal menambahkan kelas. Nama kelas mungkin sudah ada." });
  }
});
app.put("/api/classes/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { className, homeroomTeacher } = req.body;
  try {
    const result = await pool.query("UPDATE classes SET class_name = $1, homeroom_teacher = $2 WHERE id = $3 RETURNING *", [className, homeroomTeacher, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Kelas tidak ditemukan" });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Gagal memperbarui kelas. Nama kelas mungkin sudah ada." });
  }
});
app.delete("/api/classes/:id", authMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM classes WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Gagal menghapus kelas" });
  }
});

// --- API CRUD untuk Siswa ---
app.post("/api/students/bulk", authMiddleware, async (req, res) => {
  const { classId, students } = req.body;
  if (!classId || !students || !Array.isArray(students) || students.length === 0) return res.status(400).json({ error: "Data tidak valid" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const student of students) {
      const { nipd, name, gender } = student;
      await client.query(`INSERT INTO students (nipd, full_name, gender, class_id) VALUES ($1, $2, $3, $4) ON CONFLICT (nipd) DO UPDATE SET full_name = $2, gender = $3, class_id = $4`, [nipd, name, gender, classId]);
    }
    await client.query("COMMIT");
    res.status(201).json({ success: true, message: `${students.length} siswa berhasil disimpan.` });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Gagal menyimpan data siswa" });
  } finally {
    client.release();
  }
});
app.delete("/api/students/:id", authMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM students WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Gagal menghapus siswa" });
  }
});

// --- Rute API Data Utama ---
app.get("/api/initial-data", authMiddleware, async (req, res) => {
  try {
    const [classesResult, studentsResult] = await Promise.all([
      pool.query("SELECT id, class_name FROM classes ORDER BY class_name"),
      pool.query(`
                SELECT 
                    s.id, s.nipd, s.full_name, s.gender, s.grade,
                    COALESCE(ss.status, 'Hadir') as status,
                    EXISTS (SELECT 1 FROM student_notes sn WHERE sn.student_id = s.id) as has_notes
                FROM students s
                LEFT JOIN student_status ss ON s.id = ss.student_id AND ss.status_date = CURRENT_DATE
                WHERE s.class_id = (SELECT id FROM classes ORDER BY class_name LIMIT 1)
                ORDER BY s.full_name
            `),
    ]);
    res.json({ classes: classesResult.rows, students: studentsResult.rows });
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data awal dashboard" });
  }
});
// GANTI DENGAN BLOK API INI
app.delete("/api/cleanup-daily-data", authMiddleware, async (req, res) => {
  const { date, classId } = req.body; // Terima classId dari request
  if (!date || !classId) {
    return res.status(400).json({ error: "Parameter tanggal dan ID Kelas dibutuhkan" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. RESET NILAI: Update nilai siswa di kelas tersebut menjadi 0
    const resetGradeResult = await client.query("UPDATE students SET grade = 0 WHERE class_id = $1", [classId]);

    // 2. HAPUS STATUS: Hapus data status (izin, sakit, alpa) untuk tanggal & kelas tersebut
    const statusResult = await client.query(
      `
            DELETE FROM student_status 
            WHERE status_date = $1 
            AND student_id IN (SELECT id FROM students WHERE class_id = $2)
        `,
      [date, classId]
    );

    // 3. HAPUS JURNAL: Hapus data jurnal kelas untuk tanggal & kelas tersebut
    const journalResult = await client.query("DELETE FROM class_journals WHERE journal_date = $1 AND class_id = $2", [date, classId]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Data nilai, absensi, dan jurnal harian berhasil direset.",
      resetGradesCount: resetGradeResult.rowCount,
      deletedStatusCount: statusResult.rowCount,
      deletedJournalCount: journalResult.rowCount,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error cleaning up daily data:", error);
    res.status(500).json({ error: "Gagal membersihkan data harian" });
  } finally {
    client.release();
  }
});
// PERBAIKAN: Menambahkan EXISTS subquery untuk cek catatan (`has_notes`)
app.get("/api/students", authMiddleware, async (req, res) => {
  const { classId, date } = req.query;
  try {
    const result = await pool.query(
      `
            SELECT 
                s.id, s.nipd, s.full_name, s.gender, s.grade,
                COALESCE(ss.status, 'Hadir') as status,
                EXISTS (SELECT 1 FROM student_notes sn WHERE sn.student_id = s.id) as has_notes
            FROM students s
            LEFT JOIN student_status ss ON s.id = ss.student_id AND ss.status_date = $2
            WHERE s.class_id = $1
            ORDER BY s.full_name
        `,
      [classId, date]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

app.put("/api/student/:id/grade", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { grade } = req.body;
  try {
    await pool.query("UPDATE students SET grade = $1 WHERE id = $2", [grade, id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Gagal memperbarui nilai" });
  }
});
app.put("/api/student/:id/status", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { date, status } = req.body;
  try {
    await pool.query(`INSERT INTO student_status (student_id, status_date, status) VALUES ($1, $2, $3) ON CONFLICT (student_id, status_date) DO UPDATE SET status = $3`, [id, date, status]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Gagal memperbarui status" });
  }
});

// --- API Catatan Siswa ---
app.get("/api/student/:id/notes", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT id, note_text, TO_CHAR(note_date, 'DD Mon YYYY, HH24:MI') as formatted_date FROM student_notes WHERE student_id = $1 ORDER BY note_date DESC", [id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil catatan" });
  }
});
app.post("/api/student/:id/note", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { noteText } = req.body;
  try {
    await pool.query("INSERT INTO student_notes (student_id, note_text) VALUES ($1, $2)", [id, noteText]);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Gagal menyimpan catatan" });
  }
});
app.delete("/api/notes/:noteId", authMiddleware, async (req, res) => {
  const { noteId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Ambil student_id dulu sebelum menghapus, untuk cek sisa catatan
    const studentResult = await client.query("SELECT student_id FROM student_notes WHERE id = $1", [noteId]);
    if (studentResult.rows.length === 0) {
      throw new Error("Catatan tidak ditemukan");
    }
    const { student_id } = studentResult.rows[0];

    // Hapus catatan
    await client.query("DELETE FROM student_notes WHERE id = $1", [noteId]);

    // Cek apakah masih ada catatan lain untuk siswa tersebut
    const remainingNotesResult = await client.query('SELECT EXISTS (SELECT 1 FROM student_notes WHERE student_id = $1) as "hasNotes"', [student_id]);

    await client.query("COMMIT");
    res.json({ success: true, hasNotes: remainingNotesResult.rows[0].hasNotes });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting note:", error);
    res.status(500).json({ error: "Gagal menghapus catatan" });
  } finally {
    client.release();
  }
});
// --- API Laporan Excel ---
app.get("/api/report/excel", authMiddleware, async (req, res) => {
  const { classId, month } = req.query;
  try {
    const query = `SELECT s.nipd AS "NIPD", s.full_name AS "Nama Siswa", s.grade AS "Nilai", COALESCE(status_counts.izin, 0) AS "Izin", COALESCE(status_counts.sakit, 0) AS "Sakit", COALESCE(status_counts.alpa, 0) AS "Alpa", COALESCE(note_details.notes, '') AS "Catatan Siswa" FROM students s LEFT JOIN (SELECT student_id, COUNT(*) FILTER (WHERE status = 'Izin') AS izin, COUNT(*) FILTER (WHERE status = 'Sakit') AS sakit, COUNT(*) FILTER (WHERE status = 'Alpa') AS alpa FROM student_status WHERE TO_CHAR(status_date, 'YYYY-MM') = $2 GROUP BY student_id) AS status_counts ON s.id = status_counts.student_id LEFT JOIN (SELECT student_id, STRING_AGG(note_text, E'\\n' ORDER BY note_date) AS notes FROM student_notes WHERE TO_CHAR(note_date, 'YYYY-MM') = $2 GROUP BY student_id) AS note_details ON s.id = note_details.student_id WHERE s.class_id = $1 ORDER BY s.full_name;`;
    const reportResult = await pool.query(query, [classId, month]);
    const reportData = reportResult.rows;
    const worksheet = xlsx.utils.json_to_sheet(reportData);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Laporan Absensi");
    worksheet["!cols"] = [{ wch: 15 }, { wch: 40 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 50 }];
    Object.keys(worksheet).forEach((cell) => {
      if (cell[0] === "!") return;
      worksheet[cell].s = { alignment: { wrapText: true, vertical: "top" } };
    });
    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename="laporan_${month}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: "Gagal membuat laporan Excel" });
  }
});

// --- API CRUD untuk Jurnal Kelas ---
app.get("/api/journals", authMiddleware, async (req, res) => {
  const { classId, date } = req.query;
  if (!classId || !date) return res.status(400).json({ error: "Parameter classId dan date dibutuhkan" });
  try {
    const result = await pool.query(
      `SELECT id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active FROM class_journals WHERE class_id = $1 AND journal_date = $2 ORDER BY created_at DESC`,
      [classId, date]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data jurnal" });
  }
});

// PERBAIKAN: Menyamakan format data yang dikembalikan antara POST dan PUT
app.post("/api/journals", authMiddleware, async (req, res) => {
  const { classId, journalDate, learningAchievement, materialElement, agenda, method, isActive } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO class_journals (class_id, journal_date, learning_achievement, material_element, agenda, method, is_active) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active`,
      [classId, journalDate, learningAchievement, materialElement, agenda, method, isActive]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Gagal menyimpan jurnal" });
  }
});

// --- File: server.js ---

app.put("/api/journals/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  // TAMBAHKAN 'journalDate' dari body request
  const { learningAchievement, materialElement, agenda, method, isActive, journalDate } = req.body;
  // Pastikan tanggal diterima
  if (!journalDate) {
    return res.status(400).json({ error: "Parameter tanggal dibutuhkan" });
  }

  try {
    const result = await pool.query(
      `UPDATE class_journals 
       SET 
         learning_achievement = $1, 
         material_element = $2, 
         agenda = $3, 
         method = $4, 
         is_active = $5, 
         updated_at = NOW(),
         journal_date = $6 -- TAMBAHKAN baris ini untuk update tanggal
       WHERE id = $7 -- Sesuaikan nomor parameter menjadi 7
       RETURNING id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active`,
      // TAMBAHKAN 'journalDate' ke dalam array parameter
      [learningAchievement, materialElement, agenda, method, isActive, journalDate, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Update journal error:", error); // Tambahkan log untuk debugging
    res.status(500).json({ error: "Gagal memperbarui jurnal" });
  }
});

app.delete("/api/journals/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM class_journals WHERE id = $1", [id]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Gagal menghapus jurnal" });
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  initializeDatabase();
});
