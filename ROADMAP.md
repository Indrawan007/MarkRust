# Roadmap MarkRust — penggunaan pribadi di Arch + Hyprland

## Scope yang benar

MarkRust hanya untuk penggunaan pribadi pada **Arch Linux + Hyprland (Wayland)**.
Bukan produk publik atau aplikasi yang wajib didukung lintas platform. Scope ini
menggantikan rencana rilis publik sebelumnya.

CI Windows/macOS yang sudah ada merupakan bukti regresi tambahan, bukan syarat
kelulusan. Tidak perlu beta publik, signing/notarization, installer Windows/macOS,
atau keputusan lisensi sebagai gerbang pemakaian sendiri. Kewajiban lisensi
komponen pihak ketiga tetap berlaku bila kelak didistribusikan.

## Sudah diimplementasikan

- Editor WYSIWYG/Markdown, konversi, statistik, menu, shortcut dan operasi berkas.
- Recovery disk: versi snapshot, lock antar-instance, quota, pemilih recovery,
  serta perlindungan race saat simpan/buka/baru/drop.
- Gambar remote atas izin: sanitasi/clipboard, downloader Rust terbatas,
  DNS timeout, rasterisasi PNG lokal dan CSP gambar tanpa HTTPS langsung.
- 159 tes JavaScript; build/test Rust pernah lulus di CI tiga OS. Bukti CI
  bukan bukti aplikasi berjalan di Arch/Hyprland pengguna.

## Tahap 1 — Build dan jalankan di Arch/Hyprland (prioritas berikutnya)

- Siapkan toolchain Rust/Tauri dan dependency Arch yang sesuai versi saat ini.
- Selaraskan Cargo.lock lewat Cargo; verifikasi build terkunci.
- Build binary lokal; jalankan di sesi Hyprland pengguna. Catat versi Arch,
  kernel, Hyprland, WebKitGTK, GTK, GPU/driver dan commit uji.
- Periksa dialog berkas/fokus window dan backend portal yang benar-benar dipakai.
  Jangan memasang backend tambahan atau workaround global tanpa bukti kebutuhan.

**Selesai bila:** binary lokal dapat dibuka dan digunakan pada mesin pengguna,
atau blocker lingkungan telah direproduksi dengan log yang jelas.

## Tahap 2 — Uji alur harian dan integritas tulisan

Gunakan DESKTOP-TEST-CHECKLIST.md khusus Arch/Hyprland:
- Buka/Simpan/Simpan Sebagai, Unicode/spasi, izin file, batal/gagal dialog.
- Clipboard Wayland, seleksi, shortcut vs keybind compositor, fokus dan scaling.
- Close, dua instance, crash/restart, recovery kosong/rusak dan quota gagal.
- Pastikan perubahan tertunda tidak menimpa dokumen terbaru.

**Selesai bila:** tidak ada blocker kehilangan data untuk alur pribadi yang
benar-benar dipakai; semua kasus kritis memiliki hasil native, bukan asumsi CI.
Pemilih versi manual dan pengelolaan recovery stale dapat menyusul kecuali
pengujian membuktikan keduanya perlu untuk mengamankan data.

## Tahap 3 — Verifikasi gambar/jaringan pada WebKitGTK

- Amati request sebelum/sesudah izin pada Markdown dan clipboard nyata.
- Verifikasi penolakan URL privat, redirect, payload rusak/terlalu besar.
- Pastikan CSP tetap menolak sumber jaringan langsung; catat batas HTTPS/443,
  IPv4, format gambar dan animasi yang memang tidak didukung.

**Selesai bila:** perilaku nyata sesuai kebijakan untuk penggunaan pribadi;
blokir/nonaktifkan fitur bila ada temuan keamanan yang belum diperbaiki.
Tes TLS/DNS adversarial lebih lanjut dilakukan berdasarkan risiko, bukan sebagai
alasan menunda uji aplikasi nyata tanpa batas.

## Tahap 4 — Instalasi lokal yang praktis

- Pilih binary lokal atau paket Arch/PKGBUILD bila diperlukan; bukan installer
  lintas OS. Tentukan folder instalasi dan .desktop/icon untuk launcher Hyprland.
- Catat cara update, rollback dan backup direktori data/recovery.
- Nyatakan known issues dan langkah build/jalankan yang terbukti di mesin sendiri.

**Selesai bila:** aplikasi mudah dibuka, diperbarui dan dipulihkan pada mesin
pengguna. Tidak membutuhkan rilis publik, auto-updater atau infrastruktur signing.

## Opsional setelah dipakai harian

Autosave berkas asli (opt-in + deteksi konflik), recent files, pemilih versi
recovery, font/lebar editor, tema dan optimasi dokumen besar. Prioritaskan
berdasarkan kebutuhan nyata pengguna, bukan kelengkapan produk publik.

## Aturan pelaksanaan

- Satu tahap per putaran, tes regresi untuk bug yang ditemukan.
- Bedakan status implementasi, CI, dan uji native Arch/Hyprland.
- Jangan klaim nol kehilangan data atau keamanan total.
- Jangan mengubah konfigurasi sistem/Hyprland pengguna tanpa persetujuan.
- Lihat STATUS-HANDOFF.md untuk peta kode dan sejarah implementasi.

### Persiapan tahap 1

ARCH-HYPRLAND.md dan script doctor/build/install/rollback/uninstall per-user
sudah tersedia. Build default --locked, resolusi lockfile harus eksplisit.
162 tes JS lulus termasuk fixture script; uji native di mesin pengguna masih
menunggu. Tidak ada konfigurasi Hyprland atau portal yang diubah otomatis.

### Fokus aktif — pemantapan aplikasi sebelum build

Pengguna meminta jangan build dulu. Perbaikan sekarang difokuskan pada alur
harian: feedback buka/simpan, busy controls, guard dialog/shortcut dan pencegahan
konfirmasi berulang. Baseline 168 tes frontend lulus. Build/install dan push
pemicu CI ditunda; uji native Hyprland tetap belum dilakukan.

### Tahap pemantapan 1 — dialog/pembatalan

Implementasi dan tes otomatis selesai untuk Escape/Batal dialog gambar,
seleksi/fokus, penolakan submit stale, satu picker recovery aktif, serta cleanup
listener/event lama. 175 tes frontend lulus. Tidak ada build/push; uji native
belum dilakukan. Berikutnya audit editing dua mode (seleksi, fokus, undo/redo,
paste), kemudian lifecycle recovery yang ditunda/rusak.

### Tahap pemantapan 2 — mode editor/history

No-edit toggle tidak lagi mereset Delta atau undo. Raw edit pada dokumen yang
sama diterapkan sebagai satu langkah konversi undoable; replacement document
memutus history lama. Fokus/seleksi per mode dan aria-pressed diperbaiki.
179 tes frontend lulus, tanpa build/push. Selanjutnya lifecycle recovery yang
ditunda/rusak; mapping offset lintas sintaks dan uji Hyprland bukan klaim tahap ini.

### Tahap pemantapan 3 — isolasi recovery tertunda

Implementasi beralih ke sesi kerja fresh dan read-only import arsip native,
sehingga pekerjaan baru tidak memakai arsip yang ditunda. No/Nanti saja tidak
menghapus cadangan. Item rusak ditampilkan disabled. 183 tes frontend lulus;
perubahan Rust dan tesnya **belum dikompilasi/dijalankan**, karena jangan build.
Arsip dipertahankan sesudah restore/save; UI cleanup eksplisit dan browser
fallback archive isolation masih pekerjaan tersisa. Tahap ini bukan klaim
validasi native selesai.

### Tahap pemantapan 4 — UI harian, putaran keyboard/toolbar

Perbaikan timer auto-hide saat pointer bergerak, reveal toolbar saat seleksi
keyboard, serta label aksesibel tombol format/input. 185 tes frontend lulus.
Audit GUI native, dropdown warna, scaling/jendela sempit dan clipboard nyata
belum dilakukan. Tidak membuka tahap build tanpa izin pengguna.

Putaran dropdown warna: label picker/swatch, tab order saat tertutup,
Space/panah/Home/End serta close saat fokus keluar ditambahkan tanpa modifikasi
vendor Quill. 187 tes frontend lulus; penerapan warna pada seleksi dan Escape
tercakup. Uji screen reader/WebKitGTK, popup di jendela sempit dan clipboard
Wayland tetap manual/belum dilakukan. Build tetap menunggu izin.

Putaran clipboard: hentikan uploader base64 default Quill untuk gambar lokal
paste/drop, tampilkan arahan URL HTTPS; prioritaskan plain text saat clipboard
juga membawa file. 189 tes frontend lulus. Ini bukan penambahan dukungan
screenshot/attachment. Clipboard/drop Wayland asli masih perlu validasi native
setelah build diizinkan.

Putaran drop berkas: pengunci bersama Buka/Baru, feedback gagal/batal/stale,
penolakan multi-file, serta impor tanpa path native palsu dari basename.
191 tes frontend lulus. Simpan setelah drop native meminta tujuan baru.
Transport drag/drop Wayland nyata tetap belum diuji; tidak build/install/push.

Putaran close native: satu konfirmasi untuk request berulang, pengunci
penggantian dokumen selama close, reject close saat operasi/dialog aktif,
penanganan exception dan pengecekan dirty setelah save. 193 tes frontend lulus.
CloseRequested hanya diuji melalui mock; quit/WM native belum terverifikasi.

Putaran read berkas: limit File DOM 10 MiB selaras native, penanganan abort agar
busy tidak menggantung, error picker tidak lagi dianggap cancel, serta filter
semua ekstensi didukung. 196 tes frontend lulus; belum uji GUI native/build.

Putaran lintas mode/gambar: sembunyikan kontrol format visual di Markdown,
cegah download dari DOM Quill stale, beri status raw yang sesuai, dan abaikan
hasil batch stale setelah edit/pergantian mode. 198 tes frontend lulus.
Request yang sudah berjalan bukan dibatalkan; native/WebKitGTK belum diverifikasi.

Putaran koordinasi recovery: busy controls dan pengunci antar-operasi selama
restore, catch error konfirmasi, cleanup untuk retry, dan feedback saat restore
stale akibat ketikan. 201 tes frontend lulus. Tidak mengklaim native selesai;
cleanup arsip/quota dan isolasi fallback browser tetap pekerjaan terbuka.

Putaran keterbacaan status/dialog: wrap grup status untuk jendela sempit,
peringatan panjang, pemusatan/scroll dialog dan tema recovery, serta live region
terpisah dari statistik dengan deduplikasi notice. 204 tes frontend lulus.
Computed CSS/jsdom bukan bukti layout/native atau screen reader; validasi visual
pada viewport kecil/scaling tetap belum dilakukan. Build tetap menunggu izin.

Putaran close tiga pilihan: Simpan / Keluar tanpa menyimpan / Batal menggantikan
keputusan boolean. Batal/dismiss/hasil tak dikenal tidak mengizinkan close;
fallback browser membutuhkan konfirmasi discard terpisah. 207 tes frontend
lulus. API existing dialog.message dipakai, tanpa Rust/capability baru.
Uji Escape/X dan portal dialog native tetap menunggu izin build/validasi nyata.

Putaran status backup async: epoch/generation mencegah hasil write lama mengubah
indikator dokumen tersimpan/pengganti; cleanup gagal dibedakan dari gagal backup.
209 tes frontend lulus. Tidak mengubah durability/format recovery native;
cleanup arsip dan fallback isolation tetap belum selesai, tanpa build/push.

### Prioritas urgent setelah review progres

Tutup risiko kehilangan data terlebih dahulu: native workspace clear tidak
menghapus cadangan legacy; semua restore menjadi salinan tanpa writable source
path, sehingga Simpan meminta lokasi baru. 211 tes frontend lulus, termasuk
pemisahan mock disk vs localStorage. Penghapusan arsip dibuat eksplisit kelak,
bukan otomatis; isolasi fallback browser dan konflik eksternal belum selesai.
Tetap tanpa build/install/push.

### Urgent berikutnya — konflik eksternal (preflight, bukan atomik)

Baseline isi dari Open/save dibandingkan melalui read_document sebelum Simpan
biasa. Konflik/target tak terbaca menahan write dan save-on-close, mengarahkan
Save As eksplisit. 214 tes frontend lulus. Ini belum menutup race read→write;
CAS/locking native dan uji dua proses tetap belum ada. Tanpa build/install/push.
