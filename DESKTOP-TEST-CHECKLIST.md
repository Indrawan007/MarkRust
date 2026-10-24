# Checklist validasi pribadi — Arch + Hyprland

Status awal: **BELUM DIJALANKAN di aplikasi native**. Tes jsdom, unit Rust,
subprocess, dan build CI tidak menggantikan checklist ini.

## Cara mencatat

Target wajib hanya Arch Linux + Hyprland/Wayland. Catat commit, kernel,
versi Hyprland/WebKitGTK/GTK, GPU/driver, scaling, arsitektur, tanggal dan penguji.
Status tiap kasus: PASS / FAIL / BLOCKED / BELUM DIUJI. Sertakan screenshot,
log tanpa isi dokumen privat, serta langkah reproduksi untuk FAIL.
Gunakan dokumen sintetis dan folder uji, bukan berkas kerja satu-satunya.

| Lingkungan | Commit | OS/runtime | Penguji/tanggal | Hasil |
|---|---|---|---|---|
| Arch + Hyprland (Wayland) | — | — | — | BELUM DIUJI |

## Matriks kasus pada Arch/Hyprland

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
| C01 | Tutup dokumen bersih melalui X/Alt+F4 | Tidak bertanya; proses berakhir sebagaimana diharapkan | BELUM DIUJI |
| C02 | Tutup dokumen kotor, pilih simpan, lalu batal/gagal dialog simpan | Tetap terbuka saat gagal/batal; tulisan tidak hilang | BELUM DIUJI |
| C03 | Tutup kotor tanpa simpan setelah backup sukses, buka lagi | Draf ditawarkan dan dapat dipulihkan | BELUM DIUJI |
| C04 | Recovery gagal (disk penuh/izin), lalu tutup tanpa simpan | Peringatan terlihat; handler close menahan penutupan | BELUM DIUJI |
| C05 | Close berulang saat dialog masih terbuka | Tidak ada error tak tertangani/dialog berantai yang merusak state | BELUM DIUJI |
| C06 | Tutup lewat keybind Hyprland yang biasa dipakai | Catat apakah graceful close atau kill; recovery setelah restart sesuai batas yang didokumentasikan | BELUM DIUJI |
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
- Setiap kasus kritis memiliki bukti pada Arch/Hyprland; BLOCKED bukan PASS.
- Temuan baru masuk laporan handoff dan diikuti tes regresi bila bisa diotomasi.
- Uji binary lokal dan launcher/update/rollback bila dipakai; installer lintas
  OS dan signing/notarization tidak dibutuhkan untuk target pribadi ini.

## Tambahan M3 native downloader (belum diuji manual)

- P04: URL HTTPS publik PNG/JPEG/GIF/WebP -> data PNG lokal, URL asli tetap
  pada Markdown; dokumen lain kembali diblokir.
- P05: localhost, RFC1918, link-local metadata, IPv4 reserved, IPv6-only,
  HTTP, non-443, URL dengan kredensial -> ditolak tanpa menampilkan sumber remote.
- P06: redirect publik -> privat maupun publik -> publik -> ditolak (tidak diikuti).
- P07: Content-Type salah, SVG, berkas rusak, >5 MiB streamed, dimensi >4096,
  output/cache terlalu besar -> error terlihat, editor tetap dapat digunakan.
- P08: network inspector desktop: hanya jalur native atas izin yang melakukan
  unduhan; src DOM hasil unduh data PNG. CSP menolak fetch gambar HTTP(S)
  langsung. Browser fallback sengaja memiliki kebijakan berbeda.
- P09: ganti dokumen ketika unduh sedang berjalan -> hasil lama tidak masuk
  dokumen baru. Uji DNS lambat; timeout resolver OS masih merupakan batas terbuka.

Update P09: caller lookup hostname sekarang memiliki deadline 5 detik. Uji DNS
tertahan: error harus kembali, UI tetap responsif, retry tidak menambah worker
DNS selama lookup lama belum selesai. Lookup OS bukan dibatalkan; pemuatan
hostname dapat tetap ditolak sampai resolver selesai/proses diulang. Pengujian
ini belum dijalankan di webview/OS nyata.


## Tambahan khusus Hyprland (belum diuji)

- H01: clipboard/copy-paste antara MarkRust dan aplikasi Wayland lain; uji
  plain text, rich HTML, gambar/file sesuai fitur yang benar-benar digunakan.
- H02: fokus setelah dialog gambar/Buka/Simpan; floating/tiled/fullscreen.
- H03: shortcut aplikasi tidak berbenturan dengan keybind Hyprland pengguna.
- H04: fractional scaling/font/ukuran dialog pada monitor yang digunakan.
- H05: catat backend GTK/Wayland/XWayland dan portal file chooser yang benar-benar
  aktif. Bila gagal, kumpulkan log dahulu; jangan menerapkan workaround global
  atau mengganti konfigurasi Hyprland tanpa persetujuan.

## Pemantapan UI harian — belum diuji native

- U01: lepas pin toolbar, gerakkan pointer terus di bawah toolbar; toolbar
  seharusnya tersembunyi setelah jeda, bukan menunggu mouse diam. Tab ke tombol
  harus menampilkan toolbar dan mempertahankannya selama kontrol punya fokus.
- U02: pilih teks visual dengan Shift+panah tanpa gerakan pointer; toolbar
  muncul, tetap tampil saat teks terpilih; uji menerapkan format setelahnya.
- U03: hover tombol format untuk tooltip Indonesia; cek nama input Markdown
  dan alamat gambar lewat accessibility inspector bila tersedia. Dropdown warna
  masih perlu audit keyboard/accessibility tersendiri.

- U04: picker warna teks/latar: Tab ke label, Space/Enter membuka, panah dan
  Home/End memindahkan fokus swatch. Space/Enter menerapkan ke teks terpilih;
  Escape membatalkan dan kembali ke label. Tab keluar menutup popup dan swatch
  tertutup tidak ikut urutan Tab. Uji juga klik mouse, posisi popup pada jendela
  sempit/scaling, serta nama swatch hex lewat accessibility inspector bila ada.
  Implementasi dites jsdom, checklist native ini tetap belum dijalankan.

- U05: paste screenshot PNG/JPEG dan drop gambar lokal tidak menyisipkan base64
  atau menghapus teks terpilih; paste file-only memberi arahan URL HTTPS.
  Drop berkas non-Markdown boleh menampilkan penolakan jenis berkas. Clipboard
  dengan plain text + file harus tetap memasukkan teks; rich HTML tetap memakai
  sanitizer. Coba clipboard provider Wayland yang dipakai sehari-hari, lalu
  segera ganti dokumen: tidak boleh ada gambar lokal muncul belakangan.
  Pengujian native belum dijalankan; tes otomatis hanya entry point uploader.

- U06: drop satu .md/.markdown/.txt, coba drop kedua/Buka/Baru saat masih
  membaca atau konfirmasi. Tidak boleh ada dua operasi penggantian bersamaan.
  Ketik saat read/konfirmasi: hasil drop stale harus ditolak dengan feedback.
  Uji cancel, read gagal, multi-file, lalu retry untuk memastikan lock lepas.
- U07: drop native adalah impor salinan karena File DOM hanya memberi nama.
  Ctrl+S harus meminta lokasi tujuan baru; jangan menulis basename relatif.
  Verifikasi berkas asal tidak berubah sebelum pengguna memilih tujuan simpan.
  Kedua kasus ini belum diuji di WebKitGTK/Wayland; tes DOM bukan bukti OS drop.

- U08: saat dokumen kotor tekan close/Alt+F4 berulang. Hanya satu konfirmasi;
  Buka/Baru/drop/restore tidak mengganti isi selama konfirmasi close. Close saat
  Buka/Simpan/dialog aplikasi aktif tetap membuka jendela, coba lagi sesudahnya.
- U09: saat save-on-close lambat, ketik perubahan baru: jendela harus tetap
  terbuka dengan dirty dan tulisan baru. Gagal/batal simpan atau gagal konfirmasi
  tidak boleh menutup jendela. Uji native masih belum dilakukan; hasil mock
  callback bukan bukti perilaku event WM/quit seluruh jalur.

- U10: pilih/drop berkas >10 MiB ditolak tanpa mengganti isi; abort/error baca
  melepas busy Buka dan memungkinkan retry. Tes batas tepat 10 MiB tidak berarti
  parsing dokumen besar pasti lancar: ukur responsivitas terpisah. Pastikan
  filter chooser menampilkan .md/.markdown/.txt/.mdown/.mkd. Belum diuji native.

- U11: pindah Markdown: toolbar format visual tidak tampil/masuk Tab; aksi
  berkas/mode/pin tetap ada. Edit/hapus URL gambar di raw: Muat gambar tidak
  memakai URL lama. Kembali WYSIWYG, tinjau gambar baru lalu muat eksplisit.
- U12: mulai batch gambar, lalu pindah raw/edit sebelum hasil kembali: hasil
  stale tidak diterapkan dan URL sisa tidak diunduh. Request yang sudah terkirim
  dapat tetap selesai di backend. Retry pada WYSIWYG harus memungkinkan.
  Belum diuji native; tes mock bukan bukti pembatalan jaringan.

- U13: selama picker/konfirmasi restore, Buka/Baru/Simpan/mode/gambar/close tidak
  membuka operasi lain. Ketik saat menunggu: konfirmasi restore tidak boleh
  menimpa tulisan baru dan memberi feedback stale. Gagal dialog/read lalu retry:
  lock/busy lepas, sumber recovery tetap ada. Masih belum diuji native.

- U14: jendela tiled sempit (mis. 320/480 px), nama/path panjang, dirty, gagal
  cadangan dan notice gambar: status membungkus tanpa menghilangkan tombol Muat
  gambar/peringatan; editor masih mendapat ruang yang layak. Cek scaling nyata.
- U15: dialog gambar/recovery di tengah, dapat scroll pada viewport pendek,
  tombol fokus terlihat dan item rusak disabled. Dengan screen reader bila
  tersedia, statistik mengetik tidak terus diumumkan; perubahan status penting
  tetap terbaca. Tes CSS cascade tidak memvalidasi geometri maupun speech AT.
  Keduanya tetap BELUM DIUJI native.

- U16: close dokumen kotor menawarkan Simpan, Keluar tanpa menyimpan, Batal.
  Batal harus mempertahankan isi/dirty dan fokus editor; coba Escape dan X
  pada dialog native dan catat hasil aktual plugin/portal: keduanya seharusnya
  tidak diperlakukan sebagai discard. Simpan batal/gagal tetap membuka app;
  discard hanya diteruskan jika backup berhasil. Mock Cancel lulus, perilaku
  Escape/X native BELUM DIUJI.

- U17: jika write recovery lambat/gagal lalu dokumen disimpan/diganti, hasil lama
  tidak boleh menyalakan indikator gagal backup pada dokumen bersih yang baru.
  Cleanup recovery gagal setelah file sukses tersimpan harus memperingatkan
  kemungkinan cadangan lama tersisa, bukan menyatakan file gagal disimpan.
  Tes memakai queue IPC mock; simulasi kegagalan native belum dijalankan.

- U18: cadangan legacy ditunda, lalu New/edit/Save/Open: key legacy valid maupun
  rusak tidak dihapus oleh native workspace clear. Setelah restore, Ctrl+S harus
  meminta lokasi; Cancel mempertahankan isi/dirty. Jangan otomatis menulis path
  sumber dari snapshot lama. Uji file sumber yang sudah diedit aplikasi lain;
  isinya harus tetap sampai pengguna sengaja memilih overwrite. Belum diuji
  native; ini bukan implementasi deteksi konflik eksternal.

- U19: buka dokumen, edit di MarkRust, lalu ubah/hapus file lewat aplikasi lain.
  Simpan biasa harus ditolak tanpa write, dirty/isi tetap. Save-on-close juga
  tetap membuka jendela. Save As ke tujuan baru mempertahankan file eksternal.
  Uji save berikutnya memakai baseline terbaru. Preflight bukan locking: race
  perubahan eksternal antara check/write tetap terbuka; belum diuji native.

- U20 (fallback browser): tunda legacy/sesi lama, edit lalu download Simpan atau
  New: sumber lama tetap byte-identical. Reload menawarkan sesi pekerjaan lama
  yang belum dibersihkan; restore menghasilkan salinan, edit tidak mengubah
  arsip. Quota/private-mode memberi error, bukan membuang arsip. Tab lain bisa
  tampil sebagai kandidat karena belum ada liveness/locking; jangan menganggap
  dukungan multi-tab selesai. jsdom lulus, browser nyata/restart belum diuji.
