# Checklist validasi desktop MarkRust (M2)

Status checklist manual: **BELUM DIJALANKAN di aplikasi native**. Validasi
WebDriver Linux otomatis kini tersedia sebagai bukti tambahan, tetapi tes jsdom,
unit Rust, subprocess, build CI, dan smoke WebDriver tidak menggantikan
checklist ini.

## Cara mencatat

Salin tabel untuk masing-masing OS: Windows, macOS, Linux. Catat commit,
versi OS, versi WebView/runtime, arsitektur, tanggal, dan nama penguji.
Status tiap kasus: PASS / FAIL / BLOCKED / BELUM DIUJI. Sertakan screenshot,
log tanpa isi dokumen privat, serta langkah reproduksi untuk FAIL.
Gunakan dokumen sintetis dan folder uji, bukan berkas kerja satu-satunya.

| Lingkungan | Commit | OS/runtime | Penguji/tanggal | Hasil |
|---|---|---|---|---|
| Windows | — | — | — | BELUM DIUJI |
| macOS | — | — | — | BELUM DIUJI |
| Linux | — | — | — | BELUM DIUJI |

## Bukti otomatis native Linux (tidak mengubah tabel manual)

Commit `5cf01fb`, [CI `40429916613`](https://github.com/Indrawan007/MarkRust/actions/runs/40429916613),
27 Oktober 2026: langkah **Validasi WebView Tauri native (Linux/Xvfb)** dan
**Validasi dua proses Tauri native (Linux/Xvfb)** PASS pada runner
`ubuntu-24.04`, binary Tauri + WebKitGTK melalui `tauri-driver` 2.1.0 dan
`WebKitWebDriver`. Versi WebKit mengikuti image runner dan tidak dicatat sebagai
versi manual yang sudah diverifikasi.

| ID otomatis | Cakupan yang benar-benar dijalankan | Hasil / bukti |
|---|---|---|
| A01 | Boot binary Tauri; API `window.__TAURI__`, editor, statistik, dan close handler tersedia | PASS; screenshot `01-native-boot.png` |
| A02 | Front matter, raw block, hard break, script raw tidak aktif, dan `Ctrl+Shift+M` bolak-balik | PASS; screenshot `02-native-fidelity.png` |
| A03 | Buka → edit → snapshot recovery disk → simpan → baca ulang pada path Unicode/spasi melalui IPC Rust | PASS; screenshot `03-native-saved.png` |
| A04 | `SIGKILL` → proses baru → dialog GTK nyata dijawab Yes → isi/path/dirty pulih → file belum berubah → hasil restore disimpan dan recovery dibersihkan | PASS; screenshot `04b-native-recovery-dialog.png`, `05-native-restored.png`, `06-native-recovery-saved.png` |
| A05 | Dua proses/PID dengan dokumen A/B → simpan A tanpa menghapus snapshot B → kill/restart B → restore B melalui dialog sementara editor dan file A tetap utuh | PASS; screenshot `multi-01-two-instances.png`, `multi-03-b-recovery-dialog.png`, `multi-04-b-restored-a-intact.png` |
| A06 | R02: token user-source tiap 40 ms selama >3,6 detik dengan jeda <700 ms → snapshot saat mengetik → kill/restart → restore sama dengan snapshot → file belum berubah → simpan | PASS; `r02-measurement.json`, screenshot `07b-r02-recovery-dialog.png`, `08-r02-restored.png`, `09-r02-saved.png` |
| A07 | R03: hapus seluruh isi → snapshot valid dengan Markdown kosong → kill/restart → dialog restore menghasilkan editor kosong tanpa marker lama → file lama utuh sebelum simpan → simpan kosong dan recovery bersih | PASS; screenshot `10b-r03-recovery-dialog.png`, `11-r03-restored-empty.png`, `12-r03-empty-saved.png` |

Artefak run: `native-webview-linux` (screenshot WebView/X11 + log driver,
retensi 7 hari). Pada A03/A05 hanya pemilihan path dialog Buka yang distub;
perintah `read_document`, `write_document`, recovery, serializer, dialog
restore, dan state UI nyata. Screenshot dan angka dalam `r02-measurement.json`
tidak diinspeksi di sandbox karena host unduhan artefak eksternal tidak dapat
diakses; keberhasilan A01–A07 berasal dari assertion harness dan status CI.
Selisih token R02 adalah pengukuran sampel, bukan klaim nol kehilangan.

Bukti ini **tidak** menandai F01/F02/F09/R01/R02/R03/R04 atau kasus manual lain
sebagai PASS. R01/R02/R03/R04 otomatis hanya lulus pada Linux/WebKitGTK;
interaksi manual lintas OS, window controls, network inspector, installer,
serta runtime native Windows/macOS masih harus diuji terpisah.

## Matriks kasus wajib (ulangi pada tiap OS)

| ID | Langkah | Hasil yang diharapkan | Status / bukti |
|---|---|---|---|
| F01 | Baru, edit WYSIWYG, toggle Markdown bolak-balik, Simpan Sebagai | Isi/format sesuai batas konversi, path/title benar, dirty bersih sesudah simpan | BELUM DIUJI |
| F02 | Buka/simpan path Unicode dan spasi | Isi UTF-8 utuh; path tepat | BELUM DIUJI |
| F03 | Batal Buka atau Simpan Sebagai | Isi, path, dirty, recovery tidak dibuang | BELUM DIUJI |
| F04 | Simpan ke lokasi read-only/tidak tersedia | Error terlihat; dirty dan recovery tetap ada | BELUM DIUJI |
| F05 | Ketik/ganti dokumen saat dialog Buka atau penulisan tertunda | Hasil lama tidak menimpa ketikan/dokumen baru | BELUM DIUJI |
| F06 | Ctrl/Cmd+N/O/S/Shift+S/Shift+M, menu native | Satu aksi per shortcut; tidak dobel; shortcut OS yang tak sampai ke app dicatat | BELUM DIUJI |
| F07 | Drop .md/.txt valid, drop berkas tidak didukung, drop sambil mengedit | Input valid aman; tidak menimpa perubahan yang lebih baru | BELUM DIUJI |
| F08 | Buka file mendekati 10 MB dan di atas batas | Batas baca berlaku, UI tetap dapat digunakan | BELUM DIUJI |
| F09 | Buka raw HTML/komentar, list/nested blockquote, dan hard break; toggle lalu simpan | Struktur tetap, raw read-only tidak dieksekusi, tidak ada paragraf spasi/token palsu | BELUM DIUJI |
| C01 | Tutup dokumen bersih melalui X/Alt+F4 | Tidak bertanya; proses berakhir sebagaimana diharapkan | BELUM DIUJI |
| C02 | Tutup dokumen kotor, pilih simpan, lalu batal/gagal dialog simpan | Tetap terbuka saat gagal/batal; tulisan tidak hilang | BELUM DIUJI |
| C03 | Tutup kotor tanpa simpan setelah backup sukses, buka lagi | Draf ditawarkan dan dapat dipulihkan | BELUM DIUJI |
| C04 | Recovery gagal (disk penuh/izin), lalu tutup tanpa simpan | Peringatan terlihat; handler close menahan penutupan | BELUM DIUJI |
| C05 | Close berulang saat dialog masih terbuka | Tidak ada error tak tertangani/dialog berantai yang merusak state | BELUM DIUJI |
| C06 | macOS Cmd+Q dan Dock Quit (N/A di OS lain) | Catat apakah handler dipanggil; setelah restart backup tersedia; jangan asumsikan semua jalur dicegat | BELUM DIUJI |
| R01 | Edit, tunggu backup; force-kill; buka lagi | Recovery terbaru valid dipulihkan, path/dirty benar | BELUM DIUJI |
| R02 | Ketik terus >3 detik, force-kill | Snapshot sudah ada sebelum berhenti mengetik; ukur kehilangan terakhir | BELUM DIUJI |
| R03 | Hapus semua isi, tunggu backup, force-kill | Draf kosong tetap dapat dipulihkan | BELUM DIUJI |
| R04 | Dua proses OS terpisah, dokumen A/B; simpan A, kill B, restart | A tidak menghapus B; B dapat dipulihkan | BELUM DIUJI |
| R05 | Beberapa recovery stale, pilih satu / Nanti saja | Hanya pilihan yang dipulihkan; batal tidak menghapus snapshot | BELUM DIUJI |
| R06 | Dua instance memilih recovery yang sama | Satu memperoleh lock; lainnya gagal dengan aman | BELUM DIUJI |
| R07 | Rusakkan snapshot terbaru setelah menutup proses | Fallback versi sebelumnya; semua rusak tidak dihapus otomatis | BELUM DIUJI |
| R08 | Isi direktori uji hingga batas 256 MiB | Snapshot baru ditolak; sesi lain tidak dihapus; error terlihat | BELUM DIUJI |
| R09 | Cadangan v1 lama / localStorage lama | Migrasi/penawaran bekerja tanpa menduplikasi atau menghapus draf lain | BELUM DIUJI |
| P01 | Buka Markdown/HTML dengan gambar remote, srcset, CSS url(), //host | Amati network inspector: tidak ada request tanpa izin; bila ada, FAIL keamanan | BELUM DIUJI |
| P02 | Muat gambar berizin, toggle mode, simpan, buka dokumen lain | URL/alt tetap; izin tidak bocor ke dokumen berikutnya | BELUM DIUJI |
| P03 | Paste HTML/gambar remote dari clipboard nyata | Tidak ada fetch sebelum izin, termasuk DOM sementara; uji network, bukan hanya DOM final | BELUM DIUJI |

## Gerbang kelulusan

- Tidak ada FAIL terbuka yang menyebabkan kehilangan data atau kebocoran jaringan.
- Setiap kasus kritis memiliki bukti pada tiga OS; BLOCKED bukan PASS.
- Temuan baru masuk laporan handoff dan diikuti tes regresi bila bisa diotomasi.
- Installer, signing, upgrade/uninstall diuji terpisah pada M4; menjalankan
  build development tidak membuktikan installer siap rilis.
