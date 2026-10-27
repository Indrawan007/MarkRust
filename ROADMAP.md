# Roadmap MarkRust

Tanggal acuan: 24 Oktober 2026. Roadmap ini berurutan menurut risiko, bukan
janji tanggal rilis. Selesaikan kriteria keluar tiap tahap sebelum melanjutkan.

## Titik awal

MarkRust sudah memiliki editor WYSIWYG/Markdown, operasi berkas native,
shortcut/menu, pemblokiran gambar remote berbasis izin, dan recovery otomatis
ke disk (5 versi, fallback dari snapshot rusak). Browser memakai localStorage.

Verifikasi pada commit `bf4b3c4`: 138 tes JavaScript lulus; build dan tes recovery
Rust lulus di CI Linux, Windows, macOS. Ini belum merupakan verifikasi manual
webview native atau installer. Posisi produk: kandidat uji desktop internal,
belum siap rilis publik.

## M1 — Integritas recovery dan lifecycle (prioritas kritis)

**Tujuan:** satu instance/dokumen tidak menghapus cadangan milik yang lain.

Pekerjaan:
- Tentukan identitas sesi/dokumen recovery; simpan versi per identitas.
- Pisahkan lifecycle simpan, buang, dan pemulihan; hapus hanya recovery terkait.
- Atur deteksi sesi aktif/stale tanpa menganggap snapshot instance lain sebagai
  sisa crash. Tentukan penanganan lock basi setelah crash.
- Batasi retensi per dokumen serta total disk; jangan memangkas draf aktif
  secara diam-diam. Tetap tampilkan kegagalan tulis dan cleanup.
- Uji dua instance secara bersamaan, tabrakan operasi, crash/restart, draf
  kosong, kuota/disk penuh, dan snapshot rusak.

**Kriteria keluar:** dua instance dapat mengedit dan menyimpan dokumen berbeda
secara bersamaan tanpa saling membersihkan recovery; setelah salah satunya
crash, drafnya tetap dapat dipulihkan. Draf aktif tidak hilang akibat pruning.

**Bukan cakupan:** recent files atau autosave ke berkas asli.

## M2 — Validasi desktop nyata (prioritas tinggi; bergantung M1)

**Tujuan:** membuktikan perilaku runtime, bukan hanya build/tes mock.

Pekerjaan:
- Buat checklist manual Linux, Windows, macOS dengan versi OS dan commit uji.
- Uji Baru/Buka/Simpan/Simpan Sebagai, path Unicode/spasi, file read-only,
  kegagalan tulis, dan berkas mendekati batas ukuran.
- Uji close/X, Alt+F4, Cmd+Q/Dock Quit, simpan batal/gagal, dan permintaan
  tutup berulang. Audit permission dan kegagalan registrasi listener native.
- Uji ketikan selama dialog/write tertunda, pergantian dokumen, force-quit,
  restart, serta migrasi draf localStorage.
- Catat hasil pass/fail/belum diuji dan perbaiki semua kegagalan kehilangan data.

**Kriteria keluar:** alur kritis lulus pada ketiga OS dengan bukti uji native;
tidak ada blocker kehilangan data yang diketahui. Build CI saja tidak cukup.

**Kemajuan 26 Oktober 2026:** commit `809f22f`, CI `40414344817` menambahkan dan
meluluskan WebDriver pada binary Tauri Linux/WebKitGTK untuk boot, fidelity dan
shortcut, serta buka/edit/recovery/simpan melalui IPC Rust. Dialog Buka hanya
distub pada pemilihan path. Ini adalah bukti runtime native otomatis pertama,
bukan penutupan M2: checklist manual tiga OS, dialog nyata, force-kill, dua
proses, network inspector, dan installer masih terbuka.

Lanjutan pada commit `c1e7372`, CI `40421156995`: empat kelompok native lulus di
`ubuntu-24.04`, termasuk `SIGKILL` dan proses baru yang membaca snapshot dengan
path/Markdown sama sementara file asli tidak berubah. Dialog restore tidak
dijawab, sehingga R01/restore GUI penuh dan M2 tetap terbuka. Target Linux native
dan bundel dipin ke Ubuntu 24.04 setelah dua run `ubuntu-latest` terhambat apt;
Chromium tetap berjalan pada `ubuntu-latest`.

Lanjutan pada commit `dbc0b6d`, CI `40424654018`: dialog restore GTK nyata
dijawab Yes; isi/path/dirty pulih, file tidak berubah sebelum simpan, dan hasil
restore berhasil disimpan. Harness multi-instance juga lulus untuk dua proses
A/B: simpan A tidak menghapus snapshot B, B dapat di-kill/restart/restore, dan
A tetap utuh. Ini menutup cakupan otomatis R01/R04 pada Linux saja, bukan baris
manual R01/R04 atau M1/M2; checklist tiga OS dan runtime Windows/macOS terbuka.

Lanjutan pada commit `446afb6`, CI `40427913703`: R02 membuktikan snapshot
muncul saat token user-source masih masuk tiap 40 ms; sesi berlanjut melewati
3,6 detik dengan jeda maksimum di bawah 700 ms. Kill/restart/restore serta simpan
hasil lulus; `r02-measurement.json` mencatat selisih token pada sampel sebelum
kill tanpa mengklaim nol kehilangan. Angka artefak belum diinspeksi di sandbox.
Ini menambah bukti otomatis Linux saja; R02 manual dan gerbang M1/M2 tetap terbuka.

Lanjutan pada commit `5cf01fb`, CI `40429916613`: R03 membuktikan snapshot
valid dapat berisi Markdown kosong setelah seluruh isi dihapus. Kill/restart dan
dialog restore tidak memunculkan marker lama, file asli tetap utuh sebelum
simpan, dan hasil kosong berhasil ditulis/dibaca ulang melalui Rust sebelum
recovery dibersihkan. Ini bukti otomatis Linux saja; R03 manual, checklist tiga
OS, dan gerbang M1/M2 tetap terbuka.

Lanjutan pada commit `a306044`, CI `40431135910`: R05 membuat dua stale session
dan membuktikan picker memulihkan hanya kandidat pilihan melalui
`select_recovery` serta dialog GTK. Snapshot kandidat lain tetap identik. Pada
skenario kedua, Nanti saja tidak mengubah editor dan seluruh file snapshot
tetap identik; dua kandidat masih terdaftar. Bukti ini otomatis Linux saja;
R05 manual, R06, checklist tiga OS, dan gerbang M1/M2 tetap terbuka.

Lanjutan pada commit `a6e3aac`, CI `40432064383`: R06 membuat tiga stale session
dan dua penantang yang sama-sama memilih kandidat A secara konkuren. Tepat satu
instance memperoleh lock dan memulihkan A melalui dialog GTK; yang kalah
menampilkan error tanpa mengubah editor/path/dirty. Semua snapshot awal dan file
asli tetap identik, dan versi baru hanya boleh muncul pada session A pemenang.
Bukti ini otomatis Linux saja; R06 manual, R07–R09, checklist tiga OS, dan
gerbang M1/M2 tetap terbuka.

Lanjutan pada commit `a4293ed`, CI `40432859739`: R07 merusak snapshot JSON
terbaru setelah kill dan membuktikan versi sebelumnya dipulihkan melalui dialog
GTK. Semua snapshot awal, termasuk yang corrupt, tetap identik setelah restore
dan penulisan versi berikutnya; file asli tidak berubah. Saat semua versi
dirusak, aplikasi menampilkan error tanpa kandidat/dialog restore dan tanpa
menghapus file corrupt. Bukti ini otomatis Linux saja; R07 manual, R08–R09,
checklist tiga OS, dan gerbang M1/M2 tetap terbuka.

Lanjutan pada commit `b689cb0`, CI `40434261611`: R08 memakai sparse file untuk
mengisi ukuran logis recovery tepat 256 MiB. Snapshot baru A ditolak dengan
error terlihat, editor/path/dirty tetap, dan seluruh snapshot A/B serta file asli
tetap identik. Setelah ruang dibebaskan, flush berhasil, error hilang, dirty
tetap aktif, dan sesi B tidak tersentuh. Bukti ini otomatis Linux saja; R08
manual, R09, checklist tiga OS, dan gerbang M1/M2 tetap terbuka.

Lanjutan pada commit `3d40737`, CI `40435271501`: R09 memulihkan kandidat
`recovery-v1` dari picker yang juga memuat draf v2. Write tetap di v1 dan save
hanya membersihkan legacy; draf v2 lain tetap identik. Draf localStorage lama
juga dipulihkan setelah reload saat sesi lain live/terkunci, lalu save hanya
membersihkan disk/localStorage miliknya tanpa mengubah sesi lain. Ini melengkapi
cakupan otomatis R01–R09 pada Linux saja; seluruh baris manual, checklist tiga OS,
dan gerbang M1/M2 tetap terbuka.

## M3 — Privasi gambar ditegakkan lintas lapisan (prioritas tinggi)

**Tujuan:** hilangkan izin gambar jaringan langsung dari CSP tanpa membuka
HTTP client umum ke webview.

Pekerjaan:
- Rancang perintah unduh gambar terbatas dengan persetujuan eksplisit pengguna.
- Validasi skema/host/port, DNS dan IP tujuan, termasuk setiap redirect; blokir
  loopback, alamat privat/link-local, IPv6 ekuivalen, serta DNS rebinding.
- Batasi waktu, redirect, ukuran respons secara streaming, dan jumlah request.
- Validasi tipe serta konten gambar; tentukan format aman (jangan menganggap
  semua `image/*`, khususnya SVG, otomatis aman). Jangan kirim cookie/kredensial.
- Sajikan hasil sebagai sumber lokal/data yang aman; URL Markdown asli tetap
  dipertahankan. Hapus `https:` dari `img-src` setelah jalur ini berfungsi.
- Uji Markdown/HTML berbahaya, clipboard, protocol-relative URL, redirect ke
  jaringan privat, dan nol request sebelum izin memakai browser/webview nyata.

**Kriteria keluar:** dokumen tak dipercaya tidak dapat memicu request gambar
langsung; pemuatan berizin tetap berfungsi; round-trip URL/alt terjaga;
request privat ditolak, termasuk setelah redirect/DNS resolution.

**Catatan:** M3 dapat dikerjakan setelah fondasi M1 stabil, tetapi harus selesai
sebelum mengklaim privasi jaringan yang ditegakkan oleh CSP.

**Kemajuan 27 Oktober 2026:** commit `ec9f918`, CI `40437798044` menambahkan
oracle HTTPS native untuk P01. Run `40437382967` menemukan dua request sebelum
izin karena URL remote diberikan ke `super.create()` sebelum placeholder dipasang.
Perbaikan memberikan placeholder ke blot dasar sejak awal; run final membuktikan
nol request sebelum izin dan hanya path visual yang diizinkan setelahnya, tanpa
request raw/srcset/CSS. Regresi unit bertambah menjadi 173 tes. Bukti ini otomatis
Linux saja: P01 manual, P02–P03, hardening unduhan Rust/CSP, dan gerbang M3 tetap
terbuka.

## M4 — Build reproducible dan kesiapan distribusi

**Tujuan:** orang lain dapat membangun dan memasang versi yang sama.

Pekerjaan:
- Perbarui dan commit Cargo.lock, kemudian aktifkan build/test `--locked` di CI.
- Audit dependency, izin Tauri, dan kebijakan penyertaan komponen vendor.
- Pemilik proyek memilih lisensi; tambahkan LICENSE dan pemberitahuan vendor.
- Buat kandidat bundel, uji install/launch/upgrade/uninstall di tiga OS; verifikasi
  apakah recovery/data pengguna tetap dipertahankan sesuai kebijakan.
- Tentukan signing/notarization, keterbatasan platform, dan kanal distribusi.
- Buat release notes, known issues, serta langkah pemulihan dan rollback.

**Kriteria keluar:** dependency terkunci; lisensi jelas; kandidat installer
teruji; status signing dan batasan distribusi dinyatakan secara terbuka.

## M5 — Beta terbatas dan gerbang rilis

**Tujuan:** memperoleh bukti dari pemakaian nyata sebelum rilis publik.

Pekerjaan:
- Rilis kandidat kepada kelompok penguji kecil dengan checklist dan format bug.
- Uji dokumen nyata dan batas konversi Markdown; prioritaskan kehilangan data,
  akses filesystem, kebocoran jaringan, dan recovery sebelum polish UI.
- Triase bug menurut dampak; dokumentasikan batasan yang diterima.

**Kriteria keluar:** M1–M4 selesai; tidak ada blocker data/security terbuka;
masalah mayor sudah diperbaiki atau cakupan berisiko dinonaktifkan; bukti uji,
known issues, dan catatan rilis tersedia. Beta tidak otomatis berarti stabil.

## Setelah fondasi stabil (bukan syarat rilis pertama)

1. **Autosave berkas asli, opt-in:** hanya pada path yang sudah dipilih; deteksi
   perubahan eksternal sebelum overwrite, UI konflik, backup/recovery tetap ada.
2. **Pemilih versi recovery:** tampilkan waktu/dokumen dan pratinjau sebelum
   restore; jangan menimpa tulisan aktif tanpa konfirmasi.
3. **Recent files:** tangani path hilang/berpindah dan privasi daftar berkas.
4. **Polish editor:** aksesibilitas keyboard/fokus, dokumen besar, font/lebar,
   tema, dan perbaikan fidelity konversi berdasarkan kasus nyata.

## Prinsip pelaksanaan

- Satu milestone per putaran; perubahan kecil dengan tes regresi untuk bug.
- Laporkan terpisah: tes otomatis, build CI, uji runtime native, uji installer.
- Jangan klaim nol kehilangan data atau keamanan total; nyatakan batasnya.
- Jangan autosave menimpa berkas asli tanpa persetujuan dan kontrol konflik.
- Evaluasi ulang prioritas bila pengujian menemukan risiko data/security baru.
- Update roadmap berdasarkan hasil, bukan menambahkan fitur sebelum gerbang
  tahap sebelumnya terpenuhi.

## Catatan pelaksanaan M1

- M1a diimplementasikan: direktori sesi + lock eksklusif OS, adopsi sesi
  terbengkalai setelah lock terlepas, dan perlindungan recovery v1 dengan lock.
- Belum menutup seluruh M1/M2: bukti otomatis dua proses kini ada pada Linux,
  tetapi checklist manual dua proses dan kasus kritis lain pada tiga OS masih
  diperlukan.

### Pelaksanaan M1b

- Batas penerimaan recovery 256 MiB lintas sesi, dilindungi lock OS antar-proses;
  snapshot baru ditolak pada batas tanpa menghapus recovery milik sesi lain.
- Temporary files dan recovery v1 ikut dihitung; kegagalan pruning tidak lagi
  diabaikan. Pengguna tetap perlu menyimpan berkas bila cadangan gagal.
- Ditambahkan tes proses anak yang dihentikan paksa untuk memverifikasi pelepasan
  lock OS dan pemulihan snapshot.
- Masih tersisa: UI memilih beberapa recovery, pengelolaan sesi/dokumen lebih
  lengkap, dan checklist dua aplikasi desktop nyata (M2). Jangan tandai M1/M2
  selesai hanya berdasarkan tes subprocess.

### Pelaksanaan M1c

- Pemilih startup untuk beberapa recovery, label path/waktu, batal tanpa hapus.
- Pemeriksaan ulang lock saat pemilihan dan validasi ID di backend.
- Tes DOM untuk pemilihan/batal dan path yang mengandung markup; tes ID Rust.
- M1/M2 belum ditutup: tetap diperlukan uji dialog/webview desktop nyata,
  pengelolaan recovery rusak dan versi manual, serta audit lifecycle dokumen.

### Audit lifecycle & handoff

Guard revisi ditambahkan pada Baru/Buka/drop setelah operasi async; restore
menolak dokumen kotor. 144 tes JS lulus. Hasil, batas terbuka dan langkah lanjut
ada di STATUS-HANDOFF.md; matriks uji native ada di DESKTOP-TEST-CHECKLIST.md.
M1/M2 tetap belum dinyatakan tuntas tanpa bukti runtime desktop.
