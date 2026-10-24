# Laporan status & handoff MarkRust

Tanggal: 24 Oktober 2026. Branch: `arena/bcbf3e21-markrust`.
Dokumen ini adalah titik masuk untuk melanjutkan pekerjaan; baca bersama
[ROADMAP.md](ROADMAP.md) dan [DESKTOP-TEST-CHECKLIST.md](DESKTOP-TEST-CHECKLIST.md).

## Koreksi scope — acuan utama untuk pekerjaan berikutnya

Pengguna menegaskan aplikasi **hanya untuk pribadi di Arch Linux + Hyprland**.
Pernyataan rilis publik/lintas OS di riwayat laporan ini adalah konteks rencana
lama, bukan requirement aktif. ROADMAP.md sudah diganti sesuai target tersebut.

Prioritas berikutnya: build lokal Arch dan uji GUI Wayland/Hyprland, lalu alur
harian/recovery dan jaringan WebKitGTK. Windows/macOS, installer lintas OS,
beta publik, signing/notarization dan keputusan lisensi proyek bukan gerbang
pemakaian pribadi. Tidak ada klaim bahwa uji Arch/Hyprland sudah dijalankan.

Status terbaru otomatis: 159 tes JS dan CI Rust lintas OS pernah hijau; tetap
perlu verifikasi native pada mesin pengguna. Jangan memperpanjang hardening
teoretis tanpa menguji aplikasi nyata. Versi dependency dan perilaku portal
harus diperiksa pada lingkungan Arch yang digunakan, bukan diasumsikan.

## Ringkasan jujur

Editor dan recovery native sudah diimplementasikan. M1a–M1c memiliki tes otomatis
serta build/test CI lintas OS yang hijau pada commit `0ecfd7a`. Audit lifecycle
lanjutan menambah pengaman operasi async dan membawa jumlah tes JS menjadi
**144 lulus**. CI audit `40074055940` pada commit `b931d22` juga lulus: Node serta
build/test Rust Linux, Windows, macOS.

**Kesiapan pemakaian pribadi belum diverifikasi di Arch/Hyprland pengguna.
Uji webview desktop nyata masih diperlukan.** Jangan menyamakan build CI dengan
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

- Lokal: `npm test` → **144 tests, 144 pass, 0 fail**.
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
close berulang, Cmd+Q, error IPC, dan dialog yang dibatalkan. Tidak ada bukti
runtime native dalam sesi sandbox ini. Jangan menandai M1/M2 selesai dulu.

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
network inspector pada Markdown dan clipboard asli. Celah urutan pembuatan blot telah direproduksi dan diperbaiki: keputusan
blokir kini dilakukan sebelum pemanggilan `super.create`, sehingga blot dasar
hanya menerima placeholder untuk URL yang diblokir. Tes regresi merekam setiap
penyetelan atribut src (bukan sekadar DOM akhir). Parsing HTML sementara dan
clipboard nyata tetap perlu diaudit lewat network inspector. Jika fetch teramati, perlakukan sebagai blocker.

Desain lanjutan: downloader native terbatas dengan validasi skema/DNS/IP,
redirect, ukuran/timeouts, format gambar aman; tidak membuka HTTP client umum
ke webview. Baru setelah itu hapus https dari CSP.

### 4. Build/instalasi lokal (scope terbaru)

Cargo.lock belum diselaraskan dengan dependency baru secara lokal (dialog,
serde_json, fs2). CI build tanpa --locked menyelesaikan dependency dan menyimpan
artifact cargo-lock. Perbarui lockfile lalu gunakan --locked setelah diperoleh.
Download artifact sandbox pernah terhalang host blob GitHub. Jangan edit lock
manual atau mengklaim build reproducible sebelum ini beres.

Untuk penggunaan pribadi, LICENSE proyek dan signing/notarization bukan blocker.
Jangan memilih lisensi atas nama pemilik. Prioritaskan binary lokal/launcher,
update/rollback dan backup data; installer lintas OS tidak diperlukan.

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


## Update hardening blot gambar

- Celah transient src direproduksi oleh tes sebelum perbaikan, lalu ditutup.
- URL asli tetap tersedia pada Delta; pemuatan dengan izin eksplisit tetap jalan.
- Baseline JS terbaru: **146/146 lulus** setelah `npm ci && npm test`.
- Ini bukti urutan penyetelan atribut, bukan pengamatan request jaringan pada
  webview asli. M3 dan checklist privasi belum dinyatakan selesai.

## Update parsing HTML inert

Normalisasi kini membuat dokumen kosong melalui DOMParser, kemudian membaca
HTML tak tepercaya di `template.content` yang inert. Sanitasi dan penggantian
src berjalan sebelum hasil diserahkan ke Quill. Template bersarang dibuang
agar tidak meneruskan subtree yang belum disanitasi. Tes merekam input parser
(dokumen kosong saja) dan mengunci penghapusan template bersarang.

Baseline terbaru: **148/148 tes JavaScript lulus**. Ini hardening jalur
normalisasi Markdown/HTML aplikasi; clipboard native Quill dan network aktual
masih harus diuji pada checklist P01/P03. CSP/downloader native M3 belum selesai.

## Update clipboard HTML

`ui/core/safe-clipboard.js` mendaftarkan subclass clipboard sebelum instance
Quill dibuat (aplikasi dan harness sama). convert() selalu menyaring HTML
melalui template inert; HTML paste yang juga membawa file melewati heuristic
Quill yang sebelumnya mem-parsing HTML mentah. Untuk kombinasi HTML + file,
representasi HTML yang disanitasi diprioritaskan, bukan upload heuristic.
Plaintext/URI-list/file-only tetap menggunakan jalur bawaan.

Sanitasi clipboard sengaja terpisah dari normalisasi Markdown agar label bahasa
code block/format yang sudah dinormalisasi tidak diubah ulang. Tes regresi
menjaga round-trip tersebut. Tes clipboard meliputi HTML+file, replacement
seleksi, bold, user-source event, plaintext dan editor disabled.

Baseline JS: **151/151 lulus**. Event clipboard dites dengan jsdom/Quill asli,
bukan clipboard OS. Belum ada bukti network inspector webview nyata, uji upload
file-only native, atau penegakan CSP penuh; checklist P03 tetap BELUM DIUJI.

## Update batas persetujuan gambar

Izin bulk tidak lagi berupa boolean yang membolehkan semua URL pada dokumen.
Tombol Muat gambar mengizinkan snapshot daftar URL yang ada saat diklik saja;
gambar baru dari paste berikutnya kembali diblokir. revealAllowedImages juga
memeriksa allow-list sendiri sebelum menyetel src, bukan hanya percaya bahwa
pemanggil telah meminta izin.

Dua tes baru gagal sebelum perbaikan dan lulus sesudahnya. Tes integrasi
menjaga alur approve -> paste URL baru -> placeholder + tombol izin tampil
lagi. Baseline JS terbaru: **154/154 lulus**. Ini pembatasan izin aplikasi,
bukan pembatasan host/redirect/DNS; webview network dan M3/CSP masih terbuka.

## Update variasi URL browser

Deteksi jaringan kini konservatif terhadap semua awalan HTTP(S), termasuk
bentuk tanpa slash lengkap, serta network-path dengan backslash/mixed slash.
Sebelumnya regex mensyaratkan // sehingga `https:host/path` tidak diklasifikasi
remote. Regression test mereproduksi kegagalan sebelum perbaikan. Tes juga
mencakup karakter kontrol dan entity HTML yang didekode parser inert.

Baseline JS: **156/156 lulus**. URL asli tetap disimpan dalam atribut inert/model;
perubahan ini tidak memperluas izin. Ini bukan validasi SSRF/DNS atau bukti
network webview: native downloader dan CSP ketat tetap pekerjaan M3 terpisah.

## M3 — Downloader native terbatas dan CSP gambar ketat

Update ini menggantikan catatan lama bahwa CSP masih membuka `https:` untuk
gambar. `img-src` desktop sekarang hanya self/data/blob; HTTP(S) langsung
webview ditolak CSP. Browser fallback tanpa Tauri tetap memuat URL berizin
secara langsung, jadi jaminan CSP ini khusus desktop native.

Perintah `download_image` menerima satu URL setelah tindakan pengguna, bukan
HTTP client umum. Kebijakan tahap pertama:
- Hanya HTTPS port 443 tanpa kredensial; tidak mengikuti redirect; proxy OS
  dimatikan. Tidak ada cookie jar atau header autentikasi dari webview.
- Resolusi DNS sekali, IPv4 nonpublik/reserved ditolak, alamat IPv4 dipin ke
  client TLS (host asli tetap untuk TLS/Host). IPv6 diabaikan; IPv6-only ditolak.
- Maksimal 5 MiB input, batas connect 5 detik/request 15 detik. Resolver OS
  sinkron belum punya timeout independen; operasi dijalankan di blocking pool,
  bukan thread UI. DOWNLOAD try-lock membatasi satu download native sekaligus.
- PNG/JPEG/GIF/WebP saja, Content-Type harus cocok daftar; isi harus lolos
  decoder, maksimum 4096x4096 dan allocation limit 64 MiB. Re-encode PNG
  menghindari penyajian SVG/markup mentah. Animasi menjadi satu frame.
- Output PNG maksimal 8 MiB; cache URI frontend maksimal 16 MiB per dokumen,
  paling banyak 20 URL per tindakan. Gagal memuat menampilkan error; placeholder
  dipertahankan. Data hasil unduh harus PNG data URI, bukan URL backend bebas.
- Original URL tetap pada Delta/Markdown. Cache direset saat dokumen berganti;
  hasil download lama tidak diterapkan ke dokumen pengganti.

Baseline JS: **159/159 lulus** (command path, cache/reset/model, dan CSP). Tes
Rust baru memeriksa klasifikasi IPv4/URL serta decoder/re-encode. Ini belum
bukti end-to-end SSRF/DNS/TLS/network pada tiga webview. Checklist P01–P03,
pengujian HTTP hostile endpoints, timeout DNS dan audit routing lingkungan
(private routing atas alamat publik) masih terbuka. M3 belum dinyatakan tuntas.
Cargo.lock harus diselaraskan lagi dengan reqwest/base64/image sebelum --locked.

Verifikasi downloader native: commit `41b0e37`, CI `40087345454` **success**:
Node 159 tes serta build/test Rust di Linux, Windows, macOS lulus. Bundel rilis
skipped. Ini tidak mengubah status BELUM DIUJI pada checklist webview/network.

## Update tenggat DNS native

Batas resolver OS pada catatan M3 sebelumnya kini ditangani dengan tenggat
caller **5 detik**: lookup berjalan pada satu worker DNS khusus, dan caller
kembali dengan error ketika tenggat habis. Lookup OS sendiri tidak dapat
dibatalkan; slot tetap sibuk sampai lookup itu benar-benar selesai, sehingga
percobaan ulang ditolak daripada menumpuk thread. Jika lookup tidak pernah
kembali, pemuatan hostname tetap ditolak sampai proses dimulai ulang. IP literal
melewati lookup tetapi tetap wajib lolos validasi tujuan publik di downloader.

Tes Rust deterministik memakai resolver injeksi/channel (tanpa DNS internet):
timeout, penolakan worker kedua, serta pelepasan slot pada sukses/gagal.
Baseline JS tetap **159/159 lulus**. Ini batas durasi pemanggil lookup, bukan
jaminan bahwa OS membatalkan operasi DNS atau bahwa seluruh pipeline decode
memiliki deadline wall-clock. Uji webview/network hostile tetap belum selesai.

## Pengujian transport respons hostile (otomatis)

Handler respons dipisah dari validasi URL/tujuan agar dapat diuji dengan server
TCP loopback satu-request tanpa memperlonggar command produksi. Client yang
dipakai tes tetap memakai kebijakan no_proxy/no_redirect produksi.

Kasus Rust baru: respons PNG valid, Content-Type HTML, payload rusak, ukuran
berdasarkan Content-Length dan stream tanpa Content-Length, redirect ke target
loopback yang terpantau tidak menerima koneksi, serta gambar 4097 piksel yang
ditolak decoder. Server dijalankan lokal di tes; tidak memakai endpoint internet.
Baseline JavaScript tetap **159/159 lulus**.

Batas bukti: ini tes HTTP transport/body + decoder, bukan TLS server adversarial,
DNS rebinding end-to-end, routing OS, ataupun clipboard/network webview nyata.
Command produksi tetap parse HTTPS/443 dan memvalidasi/pin IPv4 publik sebelum
memanggil handler respons. Jangan menggunakan helper internal sebagai IPC baru.

## Persiapan pemakaian Arch/Hyprland

Ditambahkan ARCH-HYPRLAND.md dan scripts/arch-local.sh:
- doctor read-only, build release dengan lokasi output tetap dan --locked default;
- --update-lock eksplisit untuk build pertama karena lockfile belum selaras;
- install per-user + launcher/icon, satu backup binary, rollback dan uninstall
  yang tidak menghapus dokumen/recovery; tidak memakai sudo/config WM.
- Tes filesystem/cargo fixture: install/update/rollback/uninstall, path spasi,
  perlindungan instalasi tidak dikelola, dan argumen build terkunci.

Baseline JS terbaru: **162/162 lulus**. bash -n lulus; doctor benar melaporkan
sandbox Debian tanpa Rust/pkg-config/Wayland. Ini bukan hasil uji GUI Arch.
Langkah berikutnya membutuhkan terminal di mesin Arch/Hyprland pengguna:
`bash scripts/arch-local.sh doctor`, lalu build dan uji mengikuti panduan.
Jangan menandai tahap 1 selesai sebelum binary benar-benar dijalankan di sana.

## Pemantapan UX harian — tanpa build native

Sesuai arahan pengguna, fokus kembali ke aplikasi dan **jangan build dulu**.
Ditambahkan feedback operasi berkas yang terpisah dari statistik/privasi:
status buka/simpan berlangsung, berhasil, batal, gagal, dan hasil stale yang
ditolak untuk mempertahankan perubahan baru. Tombol aksi terkait disabled dan
aria-busy selama operasi; buka berulang dicegah. Pesan lama dibersihkan pada
suntingan baru. Input file browser menangani event cancel bila tersedia.

Verifikasi sesi ini: **165/165 tes frontend lulus** via npm test. Tes baru
meliputi status simpan tertunda + ketikan baru, buka tertunda + repeat ditolak,
serta gagal simpan yang memulihkan tombol tanpa mengklaim sukses. Tidak ada
build/install native atau verifikasi GUI Arch pada tahap ini. Jangan memicu
build otomatis melalui push sebelum arahan jangan-build direvisi; workflow
branch saat ini menjalankan Rust build saat push.

## Pemantapan dialog dan shortcut — tanpa build

Shortcut berkas/mode kini diblokir ketika dialog in-app terbuka, baik melalui
keyboard, menu native, maupun fungsi aksi berkas. Shortcut ditahan (repeat)
tidak memicu operasi baru; event IME, Alt modifier, dan shortcut yang tidak
dikelola (copy/undo dll.) dibiarkan ke editor. Drop berkas diabaikan ketika
dialog/konfirmasi Baru/Buka masih aktif. Permintaan Baru berulang dibatasi satu
konfirmasi; tombol dipulihkan setelah batal/gagal dan tulisan tidak dibuang.

Baseline terbaru: **168/168 tes frontend lulus**, termasuk modal gambar/recovery,
menu/direct actions, repeat/IME/Alt, dan satu konfirmasi Baru saat dipanggil
berulang. Ini tes jsdom, bukan input keyboard/compositor Hyprland nyata.
Tidak ada build native/install/CI yang dijalankan; perubahan tetap lokal agar
push tidak memicu build workflow, sesuai arahan pengguna.

## Tahap pemantapan 1 — konsistensi dialog/pembatalan

Sesuai urutan yang disetujui, tahap pertama fokus pada dialog, bukan build.
- Dialog gambar menyimpan snapshot generasi/revisi dan seleksi. Escape/Batal
  membersihkan URL/error serta mengembalikan fokus/seleksi jika dokumen belum
  berubah. Submit tertunda setelah tutup atau perubahan dokumen tidak menyisipkan
  gambar pada posisi/dokumen yang salah. Reopen tidak mereset dialog yang aktif.
- Picker recovery hanya memiliki satu promise aktif per dialog. Escape/Batal
  menyelesaikan null, listener dibersihkan, fokus sebelumnya dikembalikan.
  Tombol/event close lama tidak menyelesaikan picker yang baru dibuka.
- Pemulihan startup tidak berjalan paralel dengan pemanggilan pemulihan lain.

Verifikasi: **175/175 tes frontend lulus**. Tambahan mencakup Escape, Batal,
URL invalid, submit stale, fokus/seleksi, picker berulang, event lama dan gagal
showModal. Ini tes jsdom; native Escape/focus di Hyprland belum diverifikasi.
Tidak ada build/install/push/CI pada tahap ini. Tahap editing dua mode dan
pemisahan recovery yang ditunda dari sesi edit baru masih pekerjaan berikutnya.

## Tahap pemantapan 2 — perpindahan mode dan history

Kembali ke WYSIWYG tanpa perubahan Markdown tidak lagi memuat ulang Quill atau
menghapus history. Delta/DOM tetap dipertahankan. Bila raw Markdown berubah pada
dokumen yang sama, konversi memakai satu batas history yang dapat di-undo/redo.
Dokumen pengganti tetap memutus history lama agar Undo tidak membocorkan isi
dokumen sebelumnya. Fokus kembali ke editor aktif; seleksi visual diingat dan
dibatasi panjang dokumen. Seleksi raw disimpan pada kunjungan ulang bila teks
masih sama. Tombol mode memiliki aria-pressed; mode invalid/modal ditolak.

Baseline **179/179 tes frontend lulus**. Tes tambahan memeriksa Delta, panjang
undo stack, undo/redo setelah no-op toggle dan raw edit, fokus/seleksi, dirty
state dan pemutusan history saat dokumen diganti dalam mode raw.

Batas: ini bukan pemetaan posisi presisi antara offset sintaks Markdown dan
posisi visual Quill, bukan jaminan raw source round-trip lossless, dan bukan
penyatuan native textarea undo dengan Quill. Saat kembali dari raw edit, seleksi
visual memakai posisi sebelumnya yang di-clamp; format yang tidak didukung
serializer tetap mengikuti batas lama. Scroll/fokus nyata di Hyprland belum
diuji. Tidak ada build/install/push/CI pada tahap ini.

Berikutnya: tahap 3, audit recovery ditunda/rusak dan pemisahan recovery yang
belum dipilih dari pekerjaan baru. Jangan menandai lifecycle ini selesai hanya
karena dialog Nanti saja tidak langsung menghapus file.

## Tahap pemantapan 3 — recovery ditunda/rusak (implementasi, native belum diverifikasi)

Menggantikan lifecycle lama yang otomatis mengadopsi sesi stale:
- Workspace native baru selalu memperoleh sesi kosong baru. read/list tidak
  lagi mengikat cadangan pekerjaan baru ke direktori arsip yang belum dipilih.
- select_recovery kini read-only import dan mengembalikan JSON snapshot; lock
  arsip tetap diperiksa saat baca, tetapi tidak mengganti sesi aktif. Dua
  instance dapat mengimpor salinan arsip secara terpisah setelah baca selesai,
  tanpa menulis ke arsip asal. Ini disengaja, bukan exclusive session adoption.
- Tidak memulihkan = tunda, bukan hapus. Nanti saja/konfirmasi No tidak
  membersihkan sumber. Raw archive native tetap dipertahankan bahkan setelah
  hasil impor disimpan sebagai berkas; penghapusan arsip eksplisit belum ada.
- Recovery yang semua versinya tidak terbaca ditampilkan sebagai item disabled
  dengan label berkas tetap disimpan. Gagal baca juga menampilkan feedback.

Baseline **183/183 tes frontend lulus**, termasuk mock arsip terpisah dari
workspace, edit/simpan setelah defer, read failure, read-only IPC dan item rusak.
Tes Rust ditambahkan untuk fresh workspace/import tanpa mutasi sumber dan
arsip rusak tidak dihapus, tetapi **BELUM DIJALANKAN/DIKOMPILASI** pada tahap ini.
Tidak build/install/push/CI, sesuai arahan pengguna.

Kontrak IPC select_recovery berubah dari void menjadi JSON snapshot: frontend
dan backend harus berasal dari revisi yang sama ketika build diizinkan kelak.
Jangan menguji frontend baru terhadap binary lama lalu menganggapnya kompatibel.

Batas terbuka:
- Arsip native dapat menumpuk dan ikut quota 256 MiB; belum ada UI hapus/ekspor
  arsip dengan konfirmasi. Perubahan konservatif ini memilih mempertahankan
  data daripada menghapusnya setelah penundaan/restore.
- Browser fallback dan legacy localStorage masih satu key; isolasi arsip lama
  vs pekerjaan baru pada fallback itu belum setara dengan recovery native.
- Fallback versi rusak yang masih memiliki versi valid tetap memakai versi
  valid; label rusak khusus sesi tanpa versi yang bisa dibaca.
- Uji Rust, dua proses dan GUI nyata tetap diperlukan setelah build diizinkan.

## Tahap pemantapan 4 — audit UI harian, putaran keyboard/toolbar

- Perbaiki auto-hide yang terus mengulang timer ketika pointer bergerak di luar
  toolbar: timer 400 ms yang sudah berjalan kini dibiarkan selesai.
- Seleksi teks Quill (termasuk lewat keyboard) menampilkan toolbar seketika dan
  menahannya selama range terpilih. Fokus kontrol toolbar juga tetap menampilkan.
- Tombol format berbasis SVG memperoleh nama aksesibel/title Indonesia; input
  raw Markdown dan URL gambar memperoleh aria-label; error URL dihubungkan
  melalui aria-describedby.
- **185/185 tes frontend lulus**, termasuk regresi pointer bergerak, seleksi,
  fokus toolbar dan nama kontrol. git diff --check bersih.
- Ini audit wiring DOM/jsdom, bukan bukti tampilan/fokus di WebKitGTK nyata.
  Uji dropdown warna, narrow window, scaling, clipboard dan alur native masih
  perlu pemeriksaan manual. Tidak build/install/push atau menjalankan tes Rust.

## Tahap pemantapan 4 — putaran dropdown warna

- ui/core/color-picker.js melengkapi picker hasil generate Quill, tanpa mengubah
  vendor atau mengganti handler format/backing select milik Quill.
- Label picker dan swatch memiliki nama aksesibel/title; swatch tertutup keluar
  dari urutan Tab. Space membuka/menutup atau memilih; panah bergerak antar
  swatch, Home/End ke ujung. Enter/Escape tetap memakai handler bawaan Quill.
- Fokus keluar menutup picker; Escape kembali ke label tanpa menerapkan warna.
- **187/187 tes frontend lulus**, termasuk navigasi kedua picker, pembatalan,
  fokus keluar, dan penerapan warna pada range terpilih lewat Space.
- Nama warna menggunakan nilai hex (bukan nama warna terjemahan). Belum klaim
  audit screen reader, posisi popup/jendela sempit atau WebKitGTK selesai.
  Tidak build/install/push; tes Rust/native tetap belum dijalankan.

## Tahap pemantapan 4 — putaran clipboard/file upload

- Audit menemukan uploader default Quill masih membaca gambar lokal via
  FileReader dan memasukkan data URL secara async. Ini bertentangan dengan
  kebijakan URL-only dialog gambar dan dapat selesai setelah dokumen diganti.
- Aplikasi kini menolak jalur upload bersama untuk paste/drop sebelum pembacaan
  dimulai; menampilkan feedback gunakan URL HTTPS. Tidak ada konversi lokal,
  attachment atau screenshot embedding yang ditambahkan. Ini hanya menutup
  jalur uploader default, bukan klaim menolak semua kemungkinan data URL di DOM.
- Clipboard plain text + file memilih representasi teks, mengganti seleksi dan
  mempertahankan caret; HTML tetap melalui sanitizer. File-only paste tidak
  menyisipkan/menimpa isi atau memulai pembacaan async.
- **189/189 tes frontend lulus**; tes screenshot, upload entry point yang juga
  dipakai drop, tidak ada FileReader, seleksi tetap dan teks+file. Drop event
  nyata/clipboard provider Wayland tetap belum diuji. Tidak build/install/push.

## Tahap pemantapan 4 — putaran drop berkas

- Drop kini memakai openInProgress/busy Buka hingga pembacaan dan konfirmasi
  selesai, sehingga drop/Buka/Baru tidak bersaing. finally melepas lock pada
  sukses, pembatalan, stale result dan error.
- Multi-file ditolak eksplisit; jenis tidak sesuai, cancel dan hasil stale
  memiliki feedback. Ketikan saat read/konfirmasi tidak ditimpa.
- Browser File hanya menyediakan basename, bukan path native tepercaya.
  Hasil drop pada Tauri kini menjadi dokumen tanpa path: Simpan meminta lokasi
  baru, tidak memakai basename sebagai path relatif untuk write_document.
  Ini impor salinan, bukan janji menimpa berkas yang dijatuhkan.
- **191/191 tes frontend lulus**, termasuk lock, stale read, read error,
  multi-file, cancel dan pemilihan tujuan Simpan setelah impor drop native.
- Tes memakai event drop DOM dan FileReader terkontrol; transport drop OS
  Wayland/WebKitGTK dan perilaku portal belum divalidasi. Tidak build/push.
