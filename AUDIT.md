# Audit stabilitas dan optimasi — 25 Oktober 2026

Target: penggunaan pribadi di Arch Linux + Hyprland. Tidak ada penambahan fitur
atau perubahan tampilan pada putaran ini. Audit terarah, bukan bukti bebas bug.

## Temuan yang diperbaiki

| Area | Masalah | Perbaikan / bukti |
|---|---|---|
| Close tanpa simpan | Ketikan selama write backup terakhir bisa datang setelah snapshot diambil, tetapi close tetap diteruskan | Cek generation/revision setelah backup selesai; jika berubah, close ditahan. Tes menunda IPC, mengetik, lalu memastikan backup baru diperlukan dan isi aktif tetap |
| Error reporting | Gagal dialog error native dapat menyebabkan operasi async yang semula sudah ditangani ikut reject | showError menangani kegagalan reporter; Save tetap resolve false dan melepas busy. Error gambar juga mendapat feedback persisten |
| Recovery I/O | Flush visibility/close berulang menulis snapshot sama dan menambah tekanan quota/IPC | Record write berbagi promise untuk snapshot identik (generation/revision/path/isi), termasuk hasil sukses; failure/discard menginvalidasi agar retry tidak terblokir |
| Statistik/status | Format berubah tanpa perubahan jumlah kata/karakter tetap mengganti text nodes; clearance identik ditulis ulang | Update teks/style hanya jika nilai berubah; referensi node statistik disimpan sekali |

## Pengujian aktual

- `npm test`: **234/234 lulus**.
- `npm audit --audit-level=high`: **0 vulnerabilities** pada dependency npm saat pemeriksaan.
  Ini bukan audit dependency Rust atau pembuktian keamanan runtime.
- `node --check` app.js dan seluruh ui/core/*.js: lulus.
- `bash -n scripts/arch-local.sh`, `git diff --check`: lulus.
- Uji dedup mengirim 20 flush identik setelah write pertama tanpa IPC tambahan;
  in-flight flush juga berbagi promise. Ini bukti pengurangan operasi, bukan
  benchmark latency atau klaim persentase percepatan pada desktop.
- Tes MutationObserver membuktikan formatting dengan counts sama tidak mengganti
  text node statistik. Tidak mengukur frame rate/latency WebKitGTK.

## Batas terbuka / yang tidak boleh dianggap selesai

- Konflik file eksternal masih preflight, bukan compare-and-swap atomik.
- Guard path ekspor membandingkan string, bukan ekuivalensi symlink/inode.
- Cleanup native multi-snapshot bisa parsial jika I/O gagal; UI meminta cek ulang.
- Browser Web Locks tidak melindungi tab versi lama yang tidak ikut protokol;
  cleanup sengaja ditolak jika Web Locks tidak tersedia.
- Queue native untuk snapshot berbeda tetap serial; audit ini tidak menetapkan
  batas backlog/disk latency pada beban besar. Identical-write dedup bukan
  pembatalan write yang sudah dimulai atau pengganti durability filesystem.
- Bukti screenshot pengguna mencakup aplikasi terbuka/tampilan, bukan seluruh
  checklist crash recovery, disk failure, clipboard/portal dan scaling native.
- Tidak ada benchmark GUI/dokumen besar atau pemindaian dependency Rust lokal;
  Rust toolchain tidak tersedia di sandbox. CI terpisah memeriksa build/test.

## Retest singkat di Arch setelah rebuild

1. Buka dokumen percobaan, edit, Ctrl+S; titik kuning → hijau. Edit lagi → kuning.
2. Edit, close → Keluar tanpa menyimpan; jika sempat mengetik saat backup berjalan,
   close harus tertahan. Restart dan periksa teks terbaru yang dicadangkan.
3. Buka/Simpan dengan portal, coba cancel; jangan simulasikan disk penuh pada
   direktori dokumen penting. Tes fault injection otomatis bukan bukti portal asli.
4. Bandingkan respons mengetik/pindah mode pada dokumen percobaan besar; bila ada
   lag, catat ukuran, mode, langkah dan log, bukan menebak penyebabnya.

Lihat TEST-SESSION.md dan DESKTOP-TEST-CHECKLIST.md untuk skenario lebih lengkap.
