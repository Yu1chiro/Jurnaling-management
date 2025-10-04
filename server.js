require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const pg = require("pg");
const xlsx = require("xlsx");

const app = express();
const port = 3000;

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const authMiddleware = (req, res, next) => {
  const { token } = req.cookies;
  if (token && token === "admin-authenticated") {
    next();
  } else {
    res.redirect("/");
  }
};

const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS classes ( id SERIAL PRIMARY KEY, class_name VARCHAR(50) UNIQUE NOT NULL, homeroom_teacher VARCHAR(100) );
      CREATE TABLE IF NOT EXISTS students ( id SERIAL PRIMARY KEY, nipd VARCHAR(20) UNIQUE NOT NULL, full_name VARCHAR(100) NOT NULL, gender CHAR(1), class_id INT REFERENCES classes(id) ON DELETE CASCADE );
      CREATE TABLE IF NOT EXISTS student_status ( id SERIAL PRIMARY KEY, student_id INT REFERENCES students(id) ON DELETE CASCADE, status_date DATE NOT NULL, status VARCHAR(10) DEFAULT 'Hadir', UNIQUE (student_id, status_date) );
      CREATE TABLE IF NOT EXISTS student_notes ( id SERIAL PRIMARY KEY, student_id INT REFERENCES students(id) ON DELETE CASCADE, note_date TIMESTAMPTZ DEFAULT NOW(), note_text TEXT NOT NULL );
      CREATE TABLE IF NOT EXISTS class_journals ( id SERIAL PRIMARY KEY, class_id INT REFERENCES classes(id) ON DELETE CASCADE NOT NULL, journal_date DATE NOT NULL DEFAULT CURRENT_DATE, learning_achievement TEXT, material_element TEXT, agenda TEXT, method TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
      CREATE TABLE IF NOT EXISTS student_grades ( id SERIAL PRIMARY KEY, student_id INT REFERENCES students(id) ON DELETE CASCADE, grade_date DATE NOT NULL, grade INT DEFAULT 0, UNIQUE (student_id, grade_date) );
    `);

    const columnCheck = await client.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name='students' AND column_name='grade';
    `);

    if (columnCheck.rows.length > 0) {
      console.log("Old 'grade' column found in 'students' table. Starting one-time data migration...");
      await client.query(`
        INSERT INTO student_grades (student_id, grade_date, grade)
        SELECT id, CURRENT_DATE, grade FROM students WHERE grade IS NOT NULL AND grade > 0
        ON CONFLICT (student_id, grade_date) DO NOTHING;
      `);
      await client.query("ALTER TABLE students DROP COLUMN grade;");
      console.log("Data migration completed successfully. Old 'grade' column has been removed.");
    }
    
    await client.query("COMMIT");
    console.log("Database schema is ready.");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Database initialization failed:", e);
  } finally {
    client.release();
  }
};

app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/dashboard", authMiddleware, (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/jurnal-kelas", authMiddleware, (req, res) => res.sendFile(path.join(__dirname, "public", "jurnal-kelas.html")));
app.get("/history", authMiddleware, (req, res) => res.sendFile(path.join(__dirname, "public", "history.html")));

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

app.get("/api/initial-data", authMiddleware, async (req, res) => {
  try {
    const classesResult = await pool.query("SELECT id, class_name FROM classes ORDER BY class_name");
    res.json({ classes: classesResult.rows });
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data awal dashboard" });
  }
});

app.delete("/api/cleanup-daily-data", authMiddleware, async (req, res) => {
  const { date, classId } = req.body;
  if (!date || !classId) {
    return res.status(400).json({ error: "Parameter tanggal dan ID Kelas dibutuhkan" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resetGradeResult = await client.query(`DELETE FROM student_grades WHERE grade_date = $1 AND student_id IN (SELECT id FROM students WHERE class_id = $2)`,[date, classId]);
    const statusResult = await client.query(`DELETE FROM student_status WHERE status_date = $1 AND student_id IN (SELECT id FROM students WHERE class_id = $2)`,[date, classId]);
    const journalResult = await client.query("DELETE FROM class_journals WHERE journal_date = $1 AND class_id = $2", [date, classId]);
    await client.query("COMMIT");
    res.json({
      success: true,
      message: "Data nilai, absensi, dan jurnal harian berhasil direset.",
      deletedGradesCount: resetGradeResult.rowCount,
      deletedStatusCount: statusResult.rowCount,
      deletedJournalCount: journalResult.rowCount,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Gagal membersihkan data harian" });
  } finally {
    client.release();
  }
});

app.get("/api/students", authMiddleware, async (req, res) => {
  const { classId, date } = req.query;
  try {
    const result = await pool.query(
      `SELECT 
          s.id, s.nipd, s.full_name, s.gender,
          COALESCE(sg.grade, 0) as grade,
          COALESCE(ss.status, 'Hadir') as status,
          EXISTS (SELECT 1 FROM student_notes sn WHERE sn.student_id = s.id) as has_notes
       FROM students s
       LEFT JOIN student_status ss ON s.id = ss.student_id AND ss.status_date = $2
       LEFT JOIN student_grades sg ON s.id = sg.student_id AND sg.grade_date = $2
       WHERE s.class_id = $1
       ORDER BY s.full_name`,
      [classId, date]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

app.put("/api/student/:id/grade", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { grade, date } = req.body;
  if (!date) {
    return res.status(400).json({ error: "Parameter tanggal dibutuhkan" });
  }
  try {
    await pool.query(`INSERT INTO student_grades (student_id, grade_date, grade) VALUES ($1, $2, $3) ON CONFLICT (student_id, grade_date) DO UPDATE SET grade = $3`, [id, date, grade]);
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
    const remainingNotesResult = await pool.query('SELECT EXISTS (SELECT 1 FROM student_notes WHERE student_id = $1) as "hasNotes"', [id]);
    res.status(201).json({ success: true, hasNotes: remainingNotesResult.rows[0].hasNotes });
  } catch (error) {
    res.status(500).json({ error: "Gagal menyimpan catatan" });
  }
});
app.delete("/api/notes/:noteId", authMiddleware, async (req, res) => {
  const { noteId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const studentResult = await client.query("SELECT student_id FROM student_notes WHERE id = $1", [noteId]);
    if (studentResult.rows.length === 0) {
      throw new Error("Catatan tidak ditemukan");
    }
    const { student_id } = studentResult.rows[0];
    await client.query("DELETE FROM student_notes WHERE id = $1", [noteId]);
    const remainingNotesResult = await client.query('SELECT EXISTS (SELECT 1 FROM student_notes WHERE student_id = $1) as "hasNotes"', [student_id]);
    await client.query("COMMIT");
    res.json({ success: true, hasNotes: remainingNotesResult.rows[0].hasNotes });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Gagal menghapus catatan" });
  } finally {
    client.release();
  }
});

app.get("/api/report/excel", authMiddleware, async (req, res) => {
  const { classId, month } = req.query;
  try {
    const query = `
        SELECT 
            s.nipd AS "NIPD", s.full_name AS "Nama Siswa", 
            COALESCE(grade_summary.avg_grade, 0) AS "Nilai Rata-Rata",
            COALESCE(status_counts.izin, 0) AS "Izin", COALESCE(status_counts.sakit, 0) AS "Sakit", COALESCE(status_counts.alpa, 0) AS "Alpa", 
            COALESCE(note_details.notes, '') AS "Catatan Siswa" 
        FROM students s 
        LEFT JOIN (SELECT student_id, COUNT(*) FILTER (WHERE status = 'Izin') AS izin, COUNT(*) FILTER (WHERE status = 'Sakit') AS sakit, COUNT(*) FILTER (WHERE status = 'Alpa') AS alpa FROM student_status WHERE TO_CHAR(status_date, 'YYYY-MM') = $2 GROUP BY student_id) AS status_counts ON s.id = status_counts.student_id 
        LEFT JOIN (SELECT student_id, STRING_AGG(note_text, E'\\n' ORDER BY note_date) AS notes FROM student_notes WHERE TO_CHAR(note_date, 'YYYY-MM') = $2 GROUP BY student_id) AS note_details ON s.id = note_details.student_id
        LEFT JOIN (SELECT student_id, ROUND(AVG(grade))::INT as avg_grade FROM student_grades WHERE TO_CHAR(grade_date, 'YYYY-MM') = $2 GROUP BY student_id) AS grade_summary ON s.id = grade_summary.student_id
        WHERE s.class_id = $1 ORDER BY s.full_name;`;
    const reportResult = await pool.query(query, [classId, month]);
    const reportData = reportResult.rows;
    const worksheet = xlsx.utils.json_to_sheet(reportData);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Laporan Bulanan");
    worksheet["!cols"] = [{ wch: 15 }, { wch: 40 }, { wch: 15 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 50 }];
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

app.get("/api/journals", authMiddleware, async (req, res) => {
  const { classId, date } = req.query;
  if (!classId || !date) return res.status(400).json({ error: "Parameter classId dan date dibutuhkan" });
  try {
    const result = await pool.query(`SELECT id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active FROM class_journals WHERE class_id = $1 AND journal_date = $2 ORDER BY created_at DESC`,[classId, date]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data jurnal" });
  }
});
app.post("/api/journals", authMiddleware, async (req, res) => {
  const { classId, journalDate, learningAchievement, materialElement, agenda, method, isActive } = req.body;
  try {
    const result = await pool.query(`INSERT INTO class_journals (class_id, journal_date, learning_achievement, material_element, agenda, method, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active`,[classId, journalDate, learningAchievement, materialElement, agenda, method, isActive]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Gagal menyimpan jurnal" });
  }
});
app.put("/api/journals/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { learningAchievement, materialElement, agenda, method, isActive, journalDate } = req.body;
  if (!journalDate) {
    return res.status(400).json({ error: "Parameter tanggal dibutuhkan" });
  }
  try {
    const result = await pool.query(`UPDATE class_journals SET learning_achievement = $1, material_element = $2, agenda = $3, method = $4, is_active = $5, updated_at = NOW(), journal_date = $6 WHERE id = $7 RETURNING id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active`,[learningAchievement, materialElement, agenda, method, isActive, journalDate, id]);
    res.json(result.rows[0]);
  } catch (error) {
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
app.get("/api/history-summary", authMiddleware, async (req, res) => {
  try {
    const query = `
      WITH journal_months AS (
        SELECT class_id, TO_CHAR(journal_date, 'YYYY-MM') AS month
        FROM class_journals
        GROUP BY 1, 2
      ),
      student_data_months AS (
        SELECT s.class_id, TO_CHAR(sg.grade_date, 'YYYY-MM') AS month FROM student_grades sg JOIN students s ON sg.student_id = s.id
        UNION
        SELECT s.class_id, TO_CHAR(ss.status_date, 'YYYY-MM') AS month FROM student_status ss JOIN students s ON ss.student_id = s.id
      )
      SELECT
        c.id AS class_id,
        c.class_name,
        COALESCE(jm.month, sdm.month) as month,
        (jm.month IS NOT NULL) AS has_journals,
        (sdm.month IS NOT NULL) AS has_grades
      FROM journal_months jm
      FULL OUTER JOIN student_data_months sdm ON jm.class_id = sdm.class_id AND jm.month = sdm.month
      JOIN classes c ON c.id = COALESCE(jm.class_id, sdm.class_id)
      WHERE COALESCE(jm.month, sdm.month) IS NOT NULL
      ORDER BY c.class_name, month DESC;
    `;
    const { rows } = await pool.query(query);
    const historyData = rows.reduce((acc, row) => {
      let classEntry = acc.find(c => c.class_id === row.class_id);
      if (!classEntry) {
        classEntry = {
          class_id: row.class_id,
          class_name: row.class_name,
          months: []
        };
        acc.push(classEntry);
      }
      classEntry.months.push({
        month: row.month,
        has_journals: row.has_journals,
        has_grades: row.has_grades
      });
      return acc;
    }, []);
    res.json(historyData);
  } catch (error) {
    console.error("Error fetching history summary:", error);
    res.status(500).json({ error: "Gagal mengambil riwayat data" });
  }
});

app.get("/api/report/journals-monthly", authMiddleware, async (req, res) => {
    const { classId, month } = req.query;
    if (!classId || !month) {
        return res.status(400).json({ error: "Parameter classId dan month dibutuhkan" });
    }
    try {
        const result = await pool.query(
            `SELECT id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active 
             FROM class_journals 
             WHERE class_id = $1 AND TO_CHAR(journal_date, 'YYYY-MM') = $2 
             ORDER BY journal_date ASC`,
            [classId, month]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: "Gagal mengambil data jurnal bulanan" });
    }
});
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  initializeDatabase();
});