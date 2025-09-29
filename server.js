require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const pg = require('pg');
const xlsx = require('xlsx');

const app = express();
const port = 3000;

// Konfigurasi koneksi database dari .env
const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware untuk proteksi halaman dashboard
const authMiddleware = (req, res, next) => {
    const { token } = req.cookies;
    if (token && token === 'admin-authenticated') {
        next();
    } else {
        res.redirect('/login.html');
    }
};

// Fungsi untuk inisialisasi database dan seeding data
 const initializeDatabase = async () => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                // TAMBAHKAN BARIS INI untuk membersihkan tabel lama
                await client.query('DROP TABLE IF EXISTS student_notes, student_status, students, classes CASCADE;');

                // Kode di bawah ini akan membuat ulang tabel dengan struktur yang BENAR
                await client.query(`
                    CREATE TABLE IF NOT EXISTS classes (
                        id SERIAL PRIMARY KEY,
                        class_name VARCHAR(50) UNIQUE NOT NULL,
                        homeroom_teacher VARCHAR(100)
                    );

                    CREATE TABLE IF NOT EXISTS students (
                        id SERIAL PRIMARY KEY,
                        nipd VARCHAR(20) UNIQUE NOT NULL,
                        full_name VARCHAR(100) NOT NULL,
                        gender CHAR(1),
                        class_id INT REFERENCES classes(id) ON DELETE CASCADE,
                        grade INT DEFAULT 0
                    );

                    CREATE TABLE IF NOT EXISTS student_status (
                        id SERIAL PRIMARY KEY,
                        student_id INT REFERENCES students(id) ON DELETE CASCADE,
                        status_date DATE NOT NULL,
                        status VARCHAR(10) DEFAULT 'Hadir', -- Hadir, Izin, Sakit, Alpa
                        UNIQUE (student_id, status_date)
                    );

                    CREATE TABLE IF NOT EXISTS student_notes (
                        id SERIAL PRIMARY KEY,
                        student_id INT REFERENCES students(id) ON DELETE CASCADE,
                        note_date TIMESTAMPTZ DEFAULT NOW(),
                        note_text TEXT NOT NULL
                    );
                `);
          await client.query(`
            CREATE TABLE IF NOT EXISTS class_journals (
                id SERIAL PRIMARY KEY,
                class_id INT REFERENCES classes(id) ON DELETE CASCADE NOT NULL,
                journal_date DATE NOT NULL DEFAULT CURRENT_DATE,
                learning_achievement TEXT,
                material_element TEXT,
                agenda TEXT,
                method TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        // Data awal untuk di-seed
        const classes = [
            { name: 'XII-H', teacher: 'Ni Komang Rika Damayanti, S.Pd, M.Pd' },
            { name: 'XII-I', teacher: 'Komang Dewangga Arya Saputra, S.Pd' },
            { name: 'XII-J', teacher: 'Made Samitha Putra, S.Pd' }
        ];

        const students = {
            'XII-H': [
                { nipd: '12957', name: 'Ananda Prayoga Junior', gender: 'L' },
                { nipd: '12922', name: 'Gede Krisna Wira Yuda', gender: 'L' },
                { nipd: '12960', name: 'Gede Mas Adhi Wirangga', gender: 'L' },
                { nipd: '13002', name: 'I Dewa Gede Ari Pramana', gender: 'L' },
                { nipd: '12962', name: 'I Kadek Adyasa', gender: 'L' },
                { nipd: '13111', name: 'I Komang Tri Darmawan', gender: 'L' },
                { nipd: '13043', name: 'Kadek Cahaya Anjani Febrita', gender: 'P' },
                { nipd: '13010', name: 'Kadek Deva Vedanantha', gender: 'L' },
                { nipd: '13082', name: 'Kadek Guntur Ract Mahendra Harta', gender: 'L' },
                { nipd: '12814', name: 'Kadek Karina Putri', gender: 'P' },
                { nipd: '12933', name: 'Kadek Kayla Agustin', gender: 'P' },
                { nipd: '12815', name: 'Kadek Kesya Witari', gender: 'P' },
                { nipd: '13011', name: 'Kadek Rehan Suryawan', gender: 'L' },
                { nipd: '12786', name: 'Kadek Wilangga Satria Permana', gender: 'L' },
                { nipd: '13052', name: 'Ketut Andika Pratama', gender: 'L' },
                { nipd: '13013', name: 'Ketut Bisma Narayani', gender: 'L' },
                { nipd: '12788', name: 'Ketut Mutiara Krisnayanthi', gender: 'P' },
                { nipd: '13053', name: 'Ketut Naura Ayu', gender: 'P' },
                { nipd: '12860', name: 'Ketut Some Artana', gender: 'L' },
                { nipd: '12861', name: 'Komang Agus Tresna Pramudia', gender: 'L' },
                { nipd: '12862', name: 'Komang Alit Darmayasa', gender: 'L' },
                { nipd: '12898', name: 'Komang Bunga Ayu Lestari', gender: 'P' },
                { nipd: '12863', name: 'Komang Cantika Anatasia', gender: 'P' },
                { nipd: '12789', name: 'Komang Darma Andika', gender: 'L' },
                { nipd: '12864', name: 'Komang Dika Juniarta', gender: 'L' },
                { nipd: '13056', name: 'Komang Mahendra Wiryawan', gender: 'L' },
                { nipd: '12940', name: 'Komang Novita Kristianti', gender: 'P' },
                { nipd: '12790', name: 'Komang Okta Setiyani', gender: 'P' },
                { nipd: '12902', name: 'Komang Sagita Pranatha', gender: 'L' },
                { nipd: '13059', name: 'Komang Suarningsih', gender: 'P' },
                { nipd: '12904', name: 'Komang Tris Sariyana', gender: 'P' },
                { nipd: '13127', name: 'Luh Mang Meita Mas Diartini', gender: 'P' },
                { nipd: '13128', name: 'Luh Putu Amanda Dewi', gender: 'P' },
                { nipd: '12943', name: 'Luh Sania Sutariani', gender: 'P' },
                { nipd: '13129', name: 'Made Dandi Ari Pratama', gender: 'L' },
                { nipd: '13131', name: 'Ni Kadek Tiara Depiyani', gender: 'P' }
            ],
            'XII-I': [
                 { nipd: '12998', name: 'Gede Agus Pramana', gender: 'L' },
                 { nipd: '13074', name: 'Gede Wira Jaya Kusuma', gender: 'L' },
                 { nipd: '12929', name: 'I Komang Hartanta Prabawa', gender: 'L' },
                 { nipd: '12888', name: 'Jesfer Ardyana', gender: 'L' },
                 { nipd: '12967', name: 'Kadek Anggi Prasintya', gender: 'P' },
                 { nipd: '12932', name: 'Kadek Aris Kusuma Jaya', gender: 'L' },
                 { nipd: '12969', name: 'Kadek Asti Riani', gender: 'P' },
                 { nipd: '12889', name: 'Kadek Dianita Ardiana Putri', gender: 'P' },
                 { nipd: '13044', name: 'Kadek Dianita Kanya Landy', gender: 'P' },
                 { nipd: '12854', name: 'Kadek Dita Wulantari', gender: 'P' },
                 { nipd: '13045', name: 'Kadek Dwi Armadi Putra', gender: 'L' },
                 { nipd: '12890', name: 'Kadek Erix Wiguna', gender: 'L' },
                 { nipd: '12778', name: 'Kadek Evans Amarah Wijaya', gender: 'L' },
                 { nipd: '12855', name: 'Kadek Exl Surya Arikesa', gender: 'L' },
                 { nipd: '13047', name: 'Kadek Juli Artini', gender: 'P' },
                 { nipd: '13048', name: 'Kadek Marcelliano Jumeda', gender: 'L' },
                 { nipd: '12818', name: 'Kadek Rina Apriliani', gender: 'P' },
                 { nipd: '13087', name: 'Kadek Rina Dwi Saputri (Ririn)', gender: 'P' },
                 { nipd: '12856', name: 'Kadek Sherlie Wijaya Putri', gender: 'P' },
                 { nipd: '12783', name: 'Kadek Subrata', gender: 'L' },
                 { nipd: '12857', name: 'Kadek Sujaya', gender: 'L' },
                 { nipd: '12892', name: 'Kadek Tarisa Mahayani Ratu Rohdmann', gender: 'P' },
                 { nipd: '12785', name: 'Kadek Weda Yana', gender: 'L' },
                 { nipd: '12859', name: 'Kadek Widi Rediasa', gender: 'L' },
                 { nipd: '12822', name: 'Ketut Adi Rastya', gender: 'L' },
                 { nipd: '12823', name: 'Ketut Apria Jelita Yanti', gender: 'P' },
                 { nipd: '12935', name: 'Ketut Ayu Sinta', gender: 'P' },
                 { nipd: '12827', name: 'Ketut Novi Ayuni', gender: 'P' },
                 { nipd: '12897', name: 'Komang Agus Setiawan', gender: 'L' },
                 { nipd: '12828', name: 'Komang Anom Utama', gender: 'L' },
                 { nipd: '13125', name: 'Komang Rista Beliartawan', gender: 'L' },
                 { nipd: '13017', name: 'Komang Satyani Anggara Wati', gender: 'P' },
                 { nipd: '13020', name: 'Luh Deby Dewantari', gender: 'P' },
                 { nipd: '12876', name: 'Putu Dita Juniawan', gender: 'L' },
                 { nipd: '13067', name: 'Wayan Agus Dharma Saputra', gender: 'L' }
            ],
             'XII-J': [
                 { nipd: '12843', name: 'Agus Somantri', gender: 'L' },
                 { nipd: '13032', name: 'Anggiria Gusti Margani', gender: 'P' },
                 { nipd: '12882', name: 'Galang Adi Nugroho', gender: 'L' },
                 { nipd: '13034', name: 'Gede Anggara Pratama Putra', gender: 'L' },
                 { nipd: '13035', name: 'Gede Bagus Suputra Yasa', gender: 'L' },
                 { nipd: '12923', name: 'Gede Raditya Darma Saputra', gender: 'L' },
                 { nipd: '12768', name: 'Gede Yoga Wicaksana', gender: 'L' },
                 { nipd: '12773', name: 'I Gusti Nengah Agus Batuaya', gender: 'L' },
                 { nipd: '12927', name: 'I Kadek Andra Susila Darma', gender: 'L' },
                 { nipd: '12774', name: 'I Kadek Marta Kurniawan', gender: 'L' },
                 { nipd: '12775', name: 'I Kadek Wahyu Sukma Aridinata', gender: 'L' },
                 { nipd: '12851', name: 'Ida Ayu Kania Putri (Dayu)', gender: 'P' },
                 { nipd: '12812', name: 'Ida Bagus Oka Adiputra (Gustu)', gender: 'L' },
                 { nipd: '12887', name: 'Ida Bagus Putu Dhrma Yoga', gender: 'L' },
                 { nipd: '12852', name: 'Kadek Desi Pratami', gender: 'P' },
                 { nipd: '12853', name: 'Kadek Diah Aris Tyanti', gender: 'P' },
                 { nipd: '13114', name: 'Kadek Guna Arta', gender: 'L' },
                 { nipd: '13115', name: 'Kadek Marta Yoga Sedana', gender: 'L' },
                 { nipd: '12782', name: 'Kadek Reno Dwi Ananda', gender: 'L' },
                 { nipd: '12974', name: 'Kadek Wita Saraswati ', gender: 'P' },
                 { nipd: '12975', name: 'Kadek Yoga Wira Saputra', gender: 'L' },
                 { nipd: '13123', name: 'Komang Maheswari Cintya Setyani', gender: 'P' },
                 { nipd: '12829', name: 'Luh Arya Candra Dewi', gender: 'P' },
                 { nipd: '12832', name: 'Luh Putu Riantini', gender: 'P' },
                 { nipd: '12835', name: 'Marsyanika Derichell Hursepuny', gender: 'P' },
                 { nipd: '13025', name: 'Natasha Athaya Aidha Kaltsum', gender: 'P' },
                 { nipd: '12836', name: 'Ni Kadek Pitri Nita Pradewi', gender: 'P' },
                 { nipd: '12837', name: 'Ni Kadek Puja Widiantari', gender: 'P' },
                 { nipd: '12991', name: 'Ni Putu Ratna Melinda Damayanti', gender: 'P' },
                 { nipd: '13099', name: 'Putu Ayu Apriliani', gender: 'P' },
                 { nipd: '13029', name: 'Putu Ayu Jena Akhila Santhi', gender: 'P' },
                 { nipd: '13138', name: 'Putu Johan Sanfrancisco', gender: 'L' },
                 { nipd: '13097', name: 'Ni Kadek Risma Ayunda', gender: 'P' }
            ]
        };
        
        for (const c of classes) {
            const res = await client.query(
                'INSERT INTO classes (class_name, homeroom_teacher) VALUES ($1, $2) ON CONFLICT (class_name) DO NOTHING RETURNING id',
                [c.name, c.teacher]
            );

            if (res.rows.length > 0) {
                const classId = res.rows[0].id;
                for (const s of students[c.name]) {
                    await client.query(
                        `INSERT INTO students (nipd, full_name, gender, class_id) VALUES ($1, $2, $3, $4) ON CONFLICT (nipd) DO NOTHING`,
                        [s.nipd, s.name, s.gender, classId]
                    );
                }
            }
        }
        
        await client.query('COMMIT');
        console.log('Database initialized and seeded successfully.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Database initialization failed:', e);
    } finally {
        client.release();
    }
};

// Rute Halaman
// --- Rute Halaman ---
app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/dashboard', authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/jurnal-kelas', authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'public', 'jurnal-kelas.html')));

// --- Rute API Otentikasi ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        res.cookie('token', 'admin-authenticated', { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// --- Rute API Data ---
app.get('/api/classes', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, class_name FROM classes ORDER BY class_name');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data kelas' });
    }
});
app.get('/api/initial-data', authMiddleware, async (req, res) => {
    try {
        // Jalankan query untuk mengambil kelas dan siswa secara paralel
        const [classesResult, studentsResult] = await Promise.all([
            // Query pertama: ambil semua kelas
            pool.query('SELECT id, class_name FROM classes ORDER BY class_name'),
            
            // Query kedua: ambil siswa dari kelas pertama untuk tanggal hari ini
            pool.query(`
                SELECT 
                    s.id, s.nipd, s.full_name, s.gender, s.grade,
                    COALESCE(ss.status, 'Hadir') as status
                FROM students s
                LEFT JOIN student_status ss ON s.id = ss.student_id AND ss.status_date = CURRENT_DATE
                WHERE s.class_id = (SELECT id FROM classes ORDER BY class_name LIMIT 1)
                ORDER BY s.full_name
            `)
        ]);

        res.json({
            classes: classesResult.rows,
            students: studentsResult.rows
        });

    } catch (error) {
        console.error("Gagal mengambil data awal:", error);
        res.status(500).json({ error: 'Gagal mengambil data awal dashboard' });
    }
});
// API untuk mendapatkan siswa (diperbarui)
app.get('/api/students', authMiddleware, async (req, res) => {
    const { classId, date } = req.query;
    try {
        const result = await pool.query(`
            SELECT 
                s.id, s.nipd, s.full_name, s.gender, s.grade,
                COALESCE(ss.status, 'Hadir') as status
            FROM students s
            LEFT JOIN student_status ss ON s.id = ss.student_id AND ss.status_date = $2
            WHERE s.class_id = $1
            ORDER BY s.full_name
        `, [classId, date]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data siswa' });
    }
});

// API untuk update nilai siswa
app.put('/api/student/:id/grade', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { grade } = req.body;
    try {
        await pool.query('UPDATE students SET grade = $1 WHERE id = $2', [grade, id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Gagal memperbarui nilai' });
    }
});

// API untuk update status (diperbarui)
app.put('/api/student/:id/status', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { date, status } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO student_status (student_id, status_date, status) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (student_id, status_date) 
             DO UPDATE SET status = $3`, 
             [id, date, status]
        );
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Gagal memperbarui status' });
    } finally {
        client.release();
    }
});

// --- API Baru untuk Catatan ---
app.get('/api/student/:id/notes', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            "SELECT id, note_text, TO_CHAR(note_date, 'DD Mon YYYY, HH24:MI') as formatted_date FROM student_notes WHERE student_id = $1 ORDER BY note_date DESC",
            [id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil catatan' });
    }
});

app.post('/api/student/:id/note', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { noteText } = req.body;
    try {
        await pool.query('INSERT INTO student_notes (student_id, note_text) VALUES ($1, $2)', [id, noteText]);
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menyimpan catatan' });
    }
});

// GANTI KESELURUHAN BLOK API EXCEL LAMA ANDA DENGAN YANG INI

app.get('/api/report/excel', authMiddleware, async (req, res) => {
    const { classId, month } = req.query; // format bulan 'YYYY-MM'
    try {
        const query = `
            SELECT
                s.nipd AS "NIPD",
                s.full_name AS "Nama Siswa",
                s.grade AS "Nilai",
                COALESCE(status_counts.izin, 0) AS "Izin",
                COALESCE(status_counts.sakit, 0) AS "Sakit",
                COALESCE(status_counts.alpa, 0) AS "Alpa",
                COALESCE(note_details.notes, '') AS "Catatan Siswa"
            FROM students s
            LEFT JOIN (
                SELECT
                    student_id,
                    COUNT(*) FILTER (WHERE status = 'Izin') AS izin,
                    COUNT(*) FILTER (WHERE status = 'Sakit') AS sakit,
                    COUNT(*) FILTER (WHERE status = 'Alpa') AS alpa
                FROM student_status
                WHERE TO_CHAR(status_date, 'YYYY-MM') = $2
                GROUP BY student_id
            ) AS status_counts ON s.id = status_counts.student_id
            LEFT JOIN (
                SELECT
                    student_id,
                    STRING_AGG(note_text, E'\\n' ORDER BY note_date) AS notes
                FROM student_notes
                WHERE TO_CHAR(note_date, 'YYYY-MM') = $2
                GROUP BY student_id
            ) AS note_details ON s.id = note_details.student_id
            WHERE s.class_id = $1
            ORDER BY s.full_name;
        `;
        
        const reportResult = await pool.query(query, [classId, month]);
        const reportData = reportResult.rows;

        const worksheet = xlsx.utils.json_to_sheet(reportData);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Laporan Absensi');
        
        // Atur lebar kolom, perlebar kolom catatan
        worksheet['!cols'] = [
            { wch: 15 }, // NIPD
            { wch: 40 }, // Nama Siswa
            { wch: 8 },  // Nilai
            { wch: 8 },  // Izin
            { wch: 8 },  // Sakit
            { wch: 8 },  // Alpa
            { wch: 50 }  // Catatan Khusus (diperlebar)
        ];

        // Aktifkan text wrapping untuk semua sel agar catatan yang panjang bisa rapi
        Object.keys(worksheet).forEach(cell => {
            if (cell[0] === '!') return;
            worksheet[cell].s = { alignment: { wrapText: true, vertical: 'top' } };
        });

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', `attachment; filename="laporan_${month}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error("Gagal membuat laporan Excel:", error);
        res.status(500).json({ error: 'Gagal membuat laporan Excel' });
    }
});
// =================================================================
// TAMBAHAN: API CRUD untuk Jurnal Kelas
// =================================================================

// GET Jurnal berdasarkan class_id dan tanggal
app.get('/api/journals', authMiddleware, async (req, res) => {
    const { classId, date } = req.query;
    if (!classId || !date) {
        return res.status(400).json({ error: 'Parameter classId dan date dibutuhkan' });
    }
    try {
        const result = await pool.query(
            `SELECT id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active 
             FROM class_journals 
             WHERE class_id = $1 AND journal_date = $2 
             ORDER BY created_at DESC`,
            [classId, date]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching journals:', error);
        res.status(500).json({ error: 'Gagal mengambil data jurnal' });
    }
});

// POST Jurnal baru
app.post('/api/journals', authMiddleware, async (req, res) => {
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
        console.error('Error creating journal:', error);
        res.status(500).json({ error: 'Gagal menyimpan jurnal' });
    }
});

// PUT (Update) Jurnal
app.put('/api/journals/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { learningAchievement, materialElement, agenda, method, isActive } = req.body;
    try {
        const result = await pool.query(
            `UPDATE class_journals 
             SET learning_achievement = $1, material_element = $2, agenda = $3, method = $4, is_active = $5, updated_at = NOW() 
             WHERE id = $6
             RETURNING id, TO_CHAR(journal_date, 'YYYY-MM-DD') as journal_date, learning_achievement, material_element, agenda, method, is_active`,
            [learningAchievement, materialElement, agenda, method, isActive, id]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating journal:', error);
        res.status(500).json({ error: 'Gagal memperbarui jurnal' });
    }
});

// DELETE Jurnal
app.delete('/api/journals/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM class_journals WHERE id = $1', [id]);
        res.status(204).send(); // No Content
    } catch (error) {
        console.error('Error deleting journal:', error);
        res.status(500).json({ error: 'Gagal menghapus jurnal' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    initializeDatabase();
});
