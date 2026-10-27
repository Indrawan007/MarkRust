# Laporan status & handoff MarkRust

## Update 27 Oktober 2026 — M2: R06 race lock recovery

- Commit `a6e3aac`, CI `40432064383`: **6/6 kelompok native tunggal dan 6/6
  kelompok multi-instance Linux/WebKitGTK lulus**. Hanya harness berubah; kode
  produksi tidak diubah.
- Tiga stale session A/B/C dibuat melalui tiga aplikasi nyata. Dua penantang baru
  mengadopsi C lalu B, sehingga keduanya tetap melihat kandidat bersama A pada
  picker. Kedua WebDriver kemudian mengklik A secara konkuren.
- Pemenang ditentukan dari state hasil race, bukan diasumsikan. Tepat satu
  instance memperoleh lock kandidat A dan membuka dialog restore GTK. Instance
  yang kalah menampilkan indikator kegagalan recovery, tidak membuka restore
  palsu, serta mempertahankan editor/path/dirty seperti sebelum race.
- Setelah GTK Yes, pemenang memulihkan Markdown/path/dirty A tanpa marker B/C.
  Ketiga snapshot awal tetap ada dan identik; file tambahan hanya boleh muncul
  pada session A yang dimenangkan. Ketiga file asli tetap identik.
- `r06-evidence.json` serta screenshot picker/dialog/pemenang/kalah tersimpan
  pada artefak `native-webview-linux` ID `12702652548`; isi visual/JSON belum
  diinspeksi dari sandbox karena host unduhan eksternal tidak dapat diakses.
  Kelulusan berasal dari assertion CI.
- Node 172 tes, Chromium 4 kelompok, dan build/test Rust tiga OS juga lulus;
  bundel rilis skipped. **R06 manual tetap BELUM DIUJI**; R01–R05 manual dan
  M1/M2 belum ditutup. R07–R09, checklist tiga OS, runtime Windows/macOS native,
  network inspector native, dan installer tetap terbuka.

## Update 27 Oktober 2026 — M2: R05 picker beberapa recovery

- Commit `a306044`, CI `40431135910`: **6/6 kelompok native tunggal dan 5/5
  kelompok multi-instance Linux/WebKitGTK lulus**. Hanya harness berubah; kode
  produksi tidak diubah.
- Dua aplikasi hidup bersamaan membuat snapshot pada session berbeda, kemudian
  keduanya di-`SIGKILL`. Proses berikutnya menampilkan picker HTML dengan dua
  path. Harness memilih kandidat yang tidak otomatis diadopsi sehingga
  `select_recovery` dan perpindahan lock nyata ikut diuji.
- Setelah dialog GTK dijawab Yes, hanya marker/path kandidat pilihan yang masuk
  editor dengan dirty aktif. Marker kandidat lain tidak masuk, file asli kedua
  dokumen tidak berubah, dan seluruh file snapshot kandidat yang tidak dipilih
  tetap identik.
- Kedua kandidat dibuat stale lagi, lalu **Nanti saja** dipilih melalui tombol
  WebDriver pada picker kedua. Editor tetap pada dokumen awal, tidak ada dialog
  GTK restore, dua kandidat tetap terdaftar, dan seluruh file snapshot sebelum/
  sesudah penundaan identik.
- `r05-evidence.json` serta screenshot picker/restore tersimpan pada artefak
  `native-webview-linux` ID `12702296185`; isi visual/JSON belum diinspeksi dari
  sandbox. Kelulusan berasal dari assertion CI.
- Node 172 tes, Chromium 4 kelompok, dan build/test Rust tiga OS juga lulus;
  bundel rilis skipped. **R05 manual tetap BELUM DIUJI**; R01–R04 manual dan
  M1/M2 belum ditutup. R06, checklist tiga OS, runtime Windows/macOS native,
  network inspector native, dan installer tetap terbuka.

## Update 27 Oktober 2026 — M2: R03 draf kosong native

- Commit `5cf01fb`, CI `40429916613`: **6/6 kelompok native tunggal dan 3/3
  langkah multi-instance Linux/WebKitGTK lulus**. Hanya harness berubah; kode
  produksi tidak diubah.
- Dokumen yang masih berisi token R02 dihapus seluruhnya melalui Quill dengan
  sumber `user`. Harness membedakan `null` (tidak ada snapshot) dari JSON valid
  dengan `markdown` kosong, lalu membuktikan snapshot kosong memiliki path yang
  benar dan tidak sama dengan isi file lama.
- Setelah `SIGKILL`/restart, dialog GTK nyata dijawab Yes. Editor dan Markdown
  canonical tetap kosong, marker lama tidak muncul, path/dirty benar, dan file
  asli masih berisi token lama sebelum simpan.
- Simpan hasil restore menuliskan Markdown kosong melalui Rust, `read_document`
  membacanya kembali dengan identik, dan recovery dibersihkan. Ini membuktikan
  penghapusan isi tidak digantikan oleh snapshot versi lama pada alur yang diuji.
- Node 172 tes, Chromium 4 kelompok, dan build/test Rust tiga OS juga lulus;
  bundel rilis skipped. Artefak `native-webview-linux` ID `12700589516`
  tersedia, tetapi isi visualnya belum diinspeksi dari sandbox.
- **R03 manual tetap BELUM DIUJI**; R01/R02/R04 manual dan M1/M2 juga belum
  ditutup. Checklist tiga OS, native Windows/macOS runtime, network inspector
  native, dan installer tetap terbuka.

## Update 27 Oktober 2026 — M2: R02 pengetikan kontinu native

- Commit tervalidasi `446afb6`, CI `40427913703`: **5/5 kelompok native tunggal
  dan 3/3 langkah multi-instance Linux/WebKitGTK lulus**. Harness R02 berada
  pada `531b44c`; tidak ada kode produksi yang diubah untuk increment ini.
- Token user-source dimasukkan setiap 40 ms selama lebih dari 3,6 detik tanpa
  menghentikan interval saat membaca snapshot. Assertion memastikan sedikitnya
  50 token, jeda antar-token maksimum di bawah 700 ms, dan snapshot muncul saat
  pengetikan masih berlangsung.
- Setelah `SIGKILL` dan proses baru, dialog GTK nyata dijawab Yes. Isi restore
  sama persis dengan snapshot pada sampel sebelum kill, path/dirty benar, dan
  file asli tidak berubah sebelum simpan. Hasil restore kemudian disimpan dan
  recovery dibersihkan.
- `r02-measurement.json` mencatat waktu snapshot, sequence editor/snapshot, jeda
  maksimum, dan selisih token pada sampel sebelum kill. Angka artefak belum
  diinspeksi dari sandbox; tidak ada klaim nol kehilangan atau jumlah pasti.
- Run `40425531548` dan `40426788056` berhenti pada apt sebelum native. Pemanggilan
  apt kemudian dibatasi 90 detik dengan maksimal tiga percobaan; run
  `40427913703` lulus. Hambatan tersebut bukan kegagalan aplikasi/R02.
- Node 172 tes, Chromium 4 kelompok, dan build/test Rust tiga OS juga lulus;
  bundel rilis skipped. Artefak `native-webview-linux` ID `12700342570`
  tersedia, tetapi isi visual dan JSON-nya belum diinspeksi dari sandbox.
- **R02 manual tetap BELUM DIUJI**; R01/R04 manual dan M1/M2 juga belum ditutup.
  Checklist tiga OS, native Windows/macOS runtime, network inspector native,
  dan installer tetap terbuka.

## Update 27 Oktober 2026 — M2: dialog restore dan dua proses native

- Commit tervalidasi `dbc0b6d`, CI `40424654018`: **4/4 kelompok native tunggal
  dan 3/3 langkah multi-instance Linux/WebKitGTK lulus**. Implementasi dialog
  berada pada `4ff4996`; harness dua proses pada `cbb726a`.
- A04 kini menjawab dialog GTK **Pulihkan draf** yang nyata melalui `xdotool`
  (Alt+Y), lalu membuktikan Markdown/path/dirty pulih. File asli tetap identik
  sebelum simpan; `saveDocument(false)` kemudian menuliskan hasil restore dan
  membersihkan recovery. Dialog restore tidak distub.
- R04 menjalankan A dan B sebagai dua proses dengan PID berbeda dan dokumen
  berbeda. Simpan A membersihkan hanya recovery A; snapshot B tetap ada. Setelah
  B di-`SIGKILL`, proses pengganti memulihkan B melalui dialog sementara A tetap
  berjalan. Editor/file A tidak berubah dan hasil restore B berhasil disimpan.
- Hanya pemilihan path pada dialog Buka yang distub. IPC file Rust, recovery,
  serializer, dialog restore, dan state UI tetap nyata.
- Run `40423318194` sebelumnya berhenti pada apt setelah 10 menit dan tidak
  menjalankan native. Batas timeout HTTP/HTTPS serta retry ditambahkan; run
  `40424654018` kemudian lulus. Ini dicatat sebagai hambatan infrastruktur,
  bukan kegagalan aplikasi.
- Node 172 tes, Chromium 4 kelompok, serta build/test Rust Linux, Windows, dan
  macOS juga lulus pada run `40424654018`; bundel rilis skipped pada push branch.
  Artefak `native-webview-linux` ID `12699665120` tersedia, tetapi isi visualnya
  belum diinspeksi dari sandbox.
- **R01/R04 manual tetap BELUM DIUJI** dan M1/M2 belum ditutup. Checklist manual
  tiga OS, native Windows/macOS runtime, network inspector native, dan installer
  masih terbuka.

## Update 26 Oktober 2026 — M2: force-kill/restart native

- Commit `c1e7372`, CI `40421156995`: **4/4 kelompok native Linux/WebKitGTK
  lulus**. Kelompok baru mematikan proses MarkRust pertama dengan `SIGKILL`,
  menjalankan driver dan proses baru dengan direktori data yang sama, lalu
  membuktikan PID berbeda dan snapshot terbaru tetap dapat dibaca.
- Path dan Markdown snapshot identik, tepat satu kandidat recovery terlihat,
  dan file asli tetap identik (tidak ada autosave). Dialog restore tidak
  dijawab, jadi ini bukan bukti restore GUI penuh dan **R01 manual belum PASS**.
- Dua run pada `ubuntu-latest` tidak menjalankan native karena apt macet; run
  `40419832339` berakhir timeout pada dependensi setelah 10 menit. Setup menjadi
  non-interactive dan build/native/bundel Linux dipin ke `ubuntu-24.04`; run
  `40421156995` kemudian lulus. Ini tercatat sebagai masalah infrastruktur CI,
  bukan kegagalan aplikasi.
- Node 172 tes, Chromium 4 kelompok, dan build/test Rust pada tiga OS juga
  lulus pada run tersebut. Artefak `native-webview-linux` memuat empat screenshot
  dan log dua generasi driver; screenshot tetap belum dapat diinspeksi dari
  sandbox karena host unduhan eksternal.
- M2 tetap terbuka: restore lewat dialog nyata, dua proses bersamaan, checklist
  manual, native Windows/macOS, dan installer belum diuji.

## Update 26 Oktober 2026 — M2: WebView native Linux otomatis

- Commit `809f22f`, CI `40414344817`: langkah **Validasi WebView Tauri native
  (Linux/Xvfb)** lulus menggunakan binary Tauri, `tauri-driver` 2.1.0, dan
  `WebKitWebDriver`; bukan Chromium/jsdom.
- Tiga kelompok lulus: boot WebKitGTK + API Tauri + close handler; raw block /
  hard break + `Ctrl+Shift+M`; serta buka → edit → recovery disk → simpan pada
  path Unicode dan spasi melalui IPC Rust.
- Hanya pemilihan path dialog Buka yang distub. Dialog manual, force-kill, dua
  proses desktop, installer, dan native Windows/macOS belum diuji. M2 tetap
  terbuka dan seluruh status checklist manual tetap **BELUM DIUJI**.
- Artefak CI `native-webview-linux` berisi screenshot dan log driver (retensi 7
  hari). Screenshot tidak diinspeksi di sandbox karena unduhan artefak memakai
  host penyimpanan eksternal yang tidak dapat diakses dari environment ini.
- Run yang sama juga lulus untuk 172 tes Node, 4 kelompok Chromium, serta
  build/test Rust Linux, Windows, dan macOS. Bundel rilis tetap dilewati pada
  push branch biasa.

## Update 26 Oktober 2026 — fidelity Markdown tahap 1B

- Raw HTML/komentar, inline HTML yang atributnya belum didukung, serta
  list/nesting/heading di dalam blockquote dipertahankan sebagai raw read-only;
  tidak lagi diratakan atau dibuang. Isi raw tidak menjadi elemen HTML aktif.
- Hard break memiliki blot inline sendiri dan diserialkan sebagai backslash +
  newline (atau `<br>` di tabel), bukan diubah menjadi paragraf baru.
- Token proteksi raw memiliki fail-safe whole-document agar kegagalan pemetaan
  tidak menyimpan token atau membuang isi. Whitespace antar-embed diuji agar
  tidak menghasilkan paragraf spasi palsu.
- Verifikasi lokal terakhir: **172 tests, 172 pass, 0 fail**;
  `git diff --check` bersih. GUI/Rust native tetap belum diuji.

## Update 26 Oktober 2026 — validasi runtime Chromium

- `npm run test:browser` lulus pada **Chromium 153.0.8010.0**: boot dan viewport
  minimum; front matter/raw block/hard break + `Ctrl+Shift+M`; buka file →
  ketik → draf recovery → download; serta nol request gambar remote sebelum
  izin dan hanya satu request yang diizinkan sesudahnya.
- Tidak ada console error maupun page error pada keempat kelompok. Screenshot
  raw/hard-break juga diperiksa: dua baris tetap dua baris dan raw tampil sebagai
  teks read-only, bukan HTML aktif.
- Job CI `Runtime Chromium` memakai tooling opsional dengan versi dipin. Hasil
  Chromium/Linux ini tidak menggantikan checklist webview/GUI native.

## Update 26 Oktober 2026 — fidelity Markdown tahap 1A

- YAML front matter dipisahkan sebelum `marked`, ditampilkan sebagai embed
  read-only di WYSIWYG, dan dikembalikan utuh oleh serializer.
- Nomor awal ordered list dan judul tautan inline disimpan sebagai metadata
  Quill sehingga bertahan saat berpindah mode dan disimpan.
- Newline berurutan di dalam blok tidak lagi di-collapse global; whitespace
  front matter dan code block lebih aman.
- Verifikasi lokal: `npm test` → **155 tests, 155 pass, 0 fail**;
  `git diff --check` bersih. GUI/Rust native tetap belum diuji pada perubahan ini.

Bagian berikut adalah laporan historis untuk konteks pekerjaan sebelumnya.

Tanggal: 24 Oktober 2026. Branch: `arena/bcbf3e21-markrust`.
Dokumen ini adalah titik masuk untuk melanjutkan pekerjaan; baca bersama
[ROADMAP.md](ROADMAP.md) dan [DESKTOP-TEST-CHECKLIST.md](DESKTOP-TEST-CHECKLIST.md).

## Ringkasan jujur

Editor dan recovery native sudah diimplementasikan. M1a–M1c memiliki tes otomatis
serta build/test CI lintas OS yang hijau pada commit `0ecfd7a`. Audit lifecycle
lanjutan menambah pengaman operasi async dan membawa jumlah tes JS menjadi
**144 lulus**. CI audit `40074055940` pada commit `b931d22` juga lulus: Node serta
build/test Rust Linux, Windows, macOS.

**Belum siap dinyatakan rilis publik. M1 belum ditutup secara keseluruhan, M2
belum dijalankan di webview desktop nyata.** Jangan menyamakan build CI dengan
uji GUI, installer, atau jaminan tidak kehilangan data.

## Sudah selesai di kode

| Area | Hasil |
|---|---|
| Fondasi | Modul konversi/statistik murni, CSS terpisah, round-trip Quill asli di jsdom, CI |
| UI | Status bar, dirty/path/title, dialog gambar in-app, toolbar diperbaiki |
| Berkas | Baru/Buka/Simpan/Simpan Sebagai, menu native, shortcut, browser fallback |
| Integritas simpan | Snapshot revisi/generasi, simpan paralel ditolak, ketikan saat write tertunda tidak dibersihkan |
| Recovery | Disk native, 5 snapshot, fallback versi rusak, draf kosong, migrasi lokal, browser localStorage |
| Jadwal backup | Debounce 700 ms, batas tunggu 3 detik, flush sebelum close/pagehide/visibility hidden |
| Kegagalan backup | Indikator terlihat, sebab native pada tooltip; close tanpa simpan ditahan bila backup gagal |
| M1a | Direktori sesi dan lock OS eksklusif; sesi aktif dilewati; crash melepas lock |
| M1b | Batas penerimaan total 256 MiB, termasuk v1/temp; lock quota lintas proses; tidak menghapus sesi lain |
| M1c | Pemilih recovery startup bila lebih dari satu; path/waktu, batal tanpa hapus, lock diperiksa ulang |
| Gambar | Placeholder + URL asli tetap di model, izin per dokumen, sanitasi HTML, tombol pemuatan eksplisit |
| Audit tambahan | Baru/Buka/drop memeriksa revisi setelah await; restore menolak dokumen kotor |

## Hasil audit lifecycle terakhir

Diperbaiki:
- Buka yang tertunda tidak boleh menimpa ketikan atau dokumen pengganti.
- Konfirmasi Baru yang tertunda tidak boleh membuang suntingan setelah dialog dimulai.
- Drop memeriksa generasi/revisi sebelum dan sesudah konfirmasi.
- Pemulihan tidak boleh berjalan di atas dokumen kotor.

Tes baru secara langsung meliputi open tertunda, konfirmasi Baru tertunda, dan
restore pada dokumen kotor. Guard drop telah dipasang tetapi race drop belum
memiliki tes otomatis tersendiri; masukkan ke uji F07.

## Verifikasi yang tersedia

- Lokal pada update 26 Oktober 2026 (tahap 1B): `npm test` → **172 tests, 172 pass, 0 fail**.
- Chromium 153 lokal: `npm run test:browser` → **4/4 kelompok lulus**, tanpa
  console/page error; cakupan dan batasnya dijelaskan pada update di atas.
- CI `40431135910`, commit `a306044`: **6/6 kelompok WebView Tauri native
  Linux/WebKitGTK dan 5/5 kelompok multi-instance lulus**, termasuk R01–R05,
  dialog restore, simpan hasil pemulihan, dua proses A/B, serta picker/Nanti
  saja. Batas bukti manual, artefak, dan cakupan OS dijelaskan pada update M2.
- Tidak ada toolchain Rust lokal; Rust diverifikasi lewat GitHub Actions.
- CI M1c `40073225635`, commit `0ecfd7a`: Node + build/test Rust Linux,
  Windows, macOS lulus. Bundel rilis tidak berjalan pada push biasa.
- Tes Rust recovery meliputi retensi/fallback rusak, isolasi sesi, quota,
  validasi ID, dan proses anak yang di-kill kemudian recovery diambil kembali.
- Tes subprocess bukan tes dua GUI desktop. Status native manual seluruhnya
  **BELUM DIUJI** sampai bukti checklist diisi.

## Belum selesai / risiko terbuka (urutan lanjutan)

### 1. Gerbang M1/M2: validasi lifecycle native

Jalankan checklist tiga OS. Audit khusus registrasi close listener, permission,
close berulang, Cmd+Q, error IPC, dan dialog yang dibatalkan. Bukti otomatis
Linux/WebKitGTK kini ada pada CI `40431135910`, termasuk dialog restore penuh,
R02/R03, dua proses A/B, dan picker beberapa recovery R05, tetapi checklist
manual lintas OS dan kasus lain belum dicakup; belum ada runtime native
Windows/macOS. Jangan menandai M1/M2 selesai dulu.

### 2. Lifecycle recovery yang masih terbatas

- Sesi recovery per proses, bukan registry beberapa dokumen per sesi.
- Save/konfirmasi buang/ganti dokumen membersihkan recovery aktif; tidak ada UI
  memilih versi snapshot manual atau hapus massal stale sessions.
- Semua snapshot rusak tidak ditampilkan di picker; file tetap dipertahankan,
  tetapi pengguna belum mendapat workflow inspeksi/perbaikan khusus.
- Memilih Nanti saja mempertahankan snapshot saat itu; jika kemudian pengguna
  mengedit/mengganti dokumen, sesi aktif masih mengikuti kebijakan lifecycle
  yang ada. Belum ada pemisahan eksplisit "arsip ditunda" vs sesi edit baru.
- Snapshot global budget dihitung saat tulis; data lama yang sudah di atas
  batas tidak dipangkas paksa. Empty session dirs/temp sisa crash belum punya
  cleanup UI. Simpan berkas asli untuk mengamankan pekerjaan saat quota gagal.
- Jangan menjalankan binary sebelum protokol lock bersama versi baru.
- File sync + rename belum menjamin durability direktori saat listrik mati.

### 3. Privasi/CSP (M3, prioritas tinggi)

`img-src` masih mengizinkan `https:`; pertahanan sekarang di aplikasi, bukan
CSP penuh. Jangan mengklaim nol request hanya dari tes DOM jsdom. Audit dengan
network inspector pada Markdown dan clipboard asli. Khususnya periksa urutan
pembuatan blot (`super.create(value)` dapat menyetel URL asli sebelum placeholder)
dan parsing HTML sementara. Jika fetch teramati, perlakukan sebagai blocker.

Desain lanjutan: downloader native terbatas dengan validasi skema/DNS/IP,
redirect, ukuran/timeouts, format gambar aman; tidak membuka HTTP client umum
ke webview. Baru setelah itu hapus https dari CSP.

### 4. Build/distribusi (M4)

Cargo.lock belum diselaraskan dengan dependency baru secara lokal (dialog,
serde_json, fs2). CI build tanpa --locked menyelesaikan dependency dan menyimpan
artifact cargo-lock. Perbarui lockfile lalu gunakan --locked setelah diperoleh.
Download artifact sandbox pernah terhalang host blob GitHub. Jangan edit lock
manual atau mengklaim build reproducible sebelum ini beres.

LICENSE proyek belum dipilih pemilik; tidak boleh dipilih atas namanya.
Installer, signing/notarization, upgrade/uninstall, kebijakan data belum diuji.

### 5. Sesudah fondasi stabil

Autosave berkas asli masih belum ada: harus opt-in, deteksi perubahan eksternal,
UI konflik, dan tetap memiliki backup. Recent files, pemilih versi, aksesibilitas,
performa dokumen besar dan tema adalah pekerjaan lanjutan, bukan alasan menunda
perbaikan blocker data/security.

## Peta berkas untuk melanjutkan

- `ui/app.js`: generasi/revisi, async operasi berkas, dirty, recovery, close/drop.
- `ui/core/recovery.js`: antrean IPC recovery; kegagalan tidak memutus antrean.
- `ui/core/recovery-picker.js`: dialog pemilih; label via textContent.
- `ui/core/drafts.js`: fallback browser dan format waktu.
- `src-tauri/src/recovery.rs`: lock sesi, quota, retensi, scan/select, tes Rust.
- `src-tauri/src/main.rs`: custom commands, read/write dokumen, menu.
- `src-tauri/capabilities/default.json`: izin dialog/window.
- `ui/core/image-policy.js`, `quill-setup.js`, `markdown.js`: privasi/render.
- `tests/boot.test.js`: integrasi jsdom + bridge Tauri palsu, termasuk race async.
- `tests/recovery*.test.js`, `tests/images.test.js`: unit/DOM keamanan/recovery.
- `.github/workflows/ci.yml`: Node, build/test Rust matrix; bundel hanya tag.

## Cara melanjutkan

1. Pastikan branch tetap `arena/bcbf3e21-markrust`; cek `git status` dan laporan ini.
2. `npm ci && npm test` untuk baseline JS. Rust: di mesin dengan toolchain +
   dependency sistem, jalankan `cargo test --manifest-path src-tauri/Cargo.toml`.
3. Isi checklist native dengan commit/runtime yang benar. Prioritaskan FAIL
   kehilangan data/network; buat reproduksi dan tes regresi sebelum fitur baru.
4. Lanjutkan lifecycle recovery ditunda/rusak jika ditemukan masalah; lalu M3.
5. Update laporan, roadmap dan hasil verifikasi setiap tahap. Jangan mengubah
   status BELUM DIUJI menjadi PASS tanpa eksekusi dan bukti.

## Commit acuan

- `bf4b3c4`: recovery disk native.
- `3c7fa47`: M1a + koreksi lock Windows.
- `c74339b`: M1b quota + tes proses kill.
- `0ecfd7a`: M1c pemilih recovery.
- `b931d22`: audit lifecycle + checklist native dan laporan handoff; CI `40074055940` lulus.
