# Sesi uji MarkRust — baseline 226 tes frontend

## Pembaruan build CI

Kode e7b3396 sudah dipush dan CI [40095363897](https://github.com/Indrawan007/MarkRust/actions/runs/40095363897)
lulus: npm test serta cargo build/cargo test di Linux, Windows dan macOS.
Ini membuktikan kompilasi/tes Rust pada runner CI, bukan GUI di Arch/Hyprland.
PR #5 tetap terbuka. Workflow tidak menghasilkan binary unduhan/installer;
artefak yang tersedia hanya cargo-lock. Lockfile checkout belum diselaraskan:
download artefak dari sandbox gagal pada endpoint storage eksternal.


## Yang sudah dijalankan di sandbox

- [x] `npm test`: 226/226 lulus.
- [x] `git diff --check`: bersih.
- [x] `bash -n scripts/arch-local.sh`: lulus.
- [x] HTTP preview: index dan modul JS memberi 200.
- [ ] Tes/kompilasi Rust: **terblokir**. Doctor menemukan tidak ada cargo,
  rustc atau pkg-config. Sandbox Debian, tanpa sesi Wayland/Hyprland.
- [ ] Uji GUI/portal/clipboard native: belum dilakukan.

Preview yang dibuka adalah **fallback browser**, bukan aplikasi native, bukan
bukti kompatibilitas WebKitGTK. HTTP 200 bukan bukti render/interaksi visual.

## Uji singkat di preview browser

Gunakan tulisan dan berkas percobaan saja; jangan mulai dengan dokumen penting.

1. Ketik teks, format, pindah Markdown/visual, undo. Pastikan isi masuk akal.
2. Buka/drop satu Markdown, edit, Simpan → periksa berkas hasil unduhan. Browser
   tidak membuktikan download tersimpan hanya karena tombol sudah diklik.
3. Ketik `RECOVERY-UJI`, tunggu >1 detik, reload, pilih pulihkan. Isi harus kembali;
   Simpan meminta tujuan/nama baru karena restore adalah salinan.
4. Tekan Ekspor cadangan (ikon arsip), pilih sumber, periksa Markdown unduhan.
   Isi/path/dirty dokumen aktif tidak berubah, sumber arsip tetap ada.
5. Tekan Hapus arsip (ikon tempat sampah), pilih arsip percobaan → Batal.
   Coba lagi → Hapus permanen: hanya arsip yang dipilih hilang. Item rusak boleh
   dihapus secara eksplisit, bukan dipulihkan. Jangan hapus arsip yang belum aman.
6. Dengan Web Locks aktif, buka dua tab di origin preview yang sama, tulis di tab
   A. Tab B tidak boleh menghapus sesi A yang masih hidup. Tutup A sepenuhnya,
   lalu buka ulang daftar di B. Pada browser tanpa Web Locks, cleanup browser
   sengaja dinonaktifkan. Tab dari versi lama tanpa protokol lock tidak terjamin.

## Uji native di Arch + Hyprland

Pakai **checkout branch arena/bcbf3e21-markrust yang memuat e7b3396 atau lebih baru**.
Kode ini sudah dipush; perbarui checkout sebelum menguji.
Backup direktori data MarkRust terlebih dahulu, tutup binary lama, lalu jalankan
perintah di terminal sesi Hyprland. Jangan install/ubah portal dulu.

```bash
bash scripts/arch-local.sh doctor
npm ci
npm test
# Sekali saja untuk menyelaraskan lockfile lama; review hasilnya.
bash scripts/arch-local.sh build --update-lock
git diff -- src-tauri/Cargo.lock
cargo test --manifest-path src-tauri/Cargo.toml --target-dir target --locked
./target/release/markrust
```

Jika doctor/build gagal, berhenti dan catat error; jangan menjalankan binary lama
seolah menguji frontend/backend baru. Kontrak select/delete recovery membutuhkan
frontend dan backend revisi yang cocok. Build bukan instalasi.

Prioritas uji native setelah build/test berhasil:

- [ ] Open/edit/save; ubah file lewat editor lain lalu Ctrl+S: ditolak tanpa
  menimpa, gunakan Save As baru. Preflight belum atomik terhadap race read→write.
- [ ] Close kotor: Simpan / Keluar tanpa menyimpan / Batal; Escape/X dialog harus
  tidak berarti discard. Ketik selama save lambat: close harus ditahan.
- [ ] Screenshot paste ditolak dengan feedback; teks clipboard tetap masuk.
- [ ] Recovery: crash/restart memakai dokumen percobaan, restore sebagai salinan,
  lalu export dan bandingkan hasilnya.
- [ ] Cleanup: arsip tidak aktif valid/rusak bisa dibersihkan setelah konfirmasi;
  sesi aktif/terkunci harus ditolak. Berkas Markdown asli tidak dihapus.
- [ ] Batal/failure cleanup melepas busy; jika native I/O gagal di tengah delete,
  periksa ulang daftar: penghapusan multi-file tidak transaksional.
- [ ] Dialog, drop, fokus keyboard, fractional scaling dan clipboard Wayland.

Laporan singkat: langkah → harapan → hasil, mode browser/native, versi/lingkungan,
serta pesan error. Jangan mengirim isi dokumen pribadi atau credential.
