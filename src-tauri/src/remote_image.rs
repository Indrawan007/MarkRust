//! Restricted, opt-in image downloader. No webview HTTP client is exposed.
use std::{io::{Read, Cursor}, net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs}, sync::{Mutex, Arc, OnceLock, atomic::{AtomicBool, Ordering}, mpsc}, time::Duration};
use base64::Engine;
use reqwest::{blocking::Client, redirect::Policy, Url};

const MAX_INPUT: u64 = 5 * 1024 * 1024;
const MAX_OUTPUT: usize = 8 * 1024 * 1024;
static DOWNLOAD: Mutex<()> = Mutex::new(());
static DNS_BUSY: OnceLock<Arc<AtomicBool>> = OnceLock::new();

// OS DNS lookup cannot be cancelled safely. Return to the caller on timeout,
// but keep the single resolver slot occupied until that lookup actually exits.
// This bounds blocked DNS workers even if the user retries repeatedly.
fn resolve_with_timeout<F>(busy: Arc<AtomicBool>, timeout: Duration, resolver: F) -> Result<Vec<SocketAddr>, String>
where F: FnOnce() -> Result<Vec<SocketAddr>, String> + Send + 'static {
    busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "Resolver DNS sebelumnya masih berjalan; coba lagi nanti".to_string())?;
    struct ResetBusy(Arc<AtomicBool>);
    impl Drop for ResetBusy {
        fn drop(&mut self) { self.0.store(false, Ordering::Release); }
    }
    let (send, receive) = mpsc::sync_channel(1);
    let worker_busy = busy.clone();
    if let Err(error) = std::thread::Builder::new().name("markrust-image-dns".into()).spawn(move || {
        let guard = ResetBusy(worker_busy);
        let result = resolver();
        drop(guard);
        let _ = send.send(result); // Receiver may already have timed out.
    }) {
        busy.store(false, Ordering::Release);
        return Err(format!("Tidak bisa memulai resolver DNS: {error}"));
    }
    match receive.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err("Resolusi DNS melebihi batas waktu".into()),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("Resolver DNS berhenti sebelum selesai".into()),
    }
}
fn resolve_host(host: String) -> Result<Vec<SocketAddr>, String> {
    // IP literals do not need a resolver worker.
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(vec![SocketAddr::new(ip, 443)]);
    }
    resolve_with_timeout(
        DNS_BUSY.get_or_init(|| Arc::new(AtomicBool::new(false))).clone(),
        Duration::from_secs(5),
        move || (host.as_str(), 443).to_socket_addrs()
            .map(|addresses| addresses.collect()).map_err(|e| e.to_string()),
    )
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a,b,c,_] = ip.octets();
    !(matches!(a, 0 | 10 | 127) || a >= 224
      || (a == 100 && (64..=127).contains(&b))
      || (a == 169 && b == 254) || (a == 172 && (16..=31).contains(&b))
      || (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
      || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
      || (a == 203 && b == 0 && c == 113))
}
fn parse_url(raw: &str) -> Result<Url, String> {
    if raw.len() > 4096 { return Err("URL terlalu panjang".into()); }
    let mut url = Url::parse(raw).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || url.port_or_known_default() != Some(443)
        || !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
        return Err("Hanya HTTPS port 443 tanpa kredensial yang didukung".into());
    }
    url.set_fragment(None);
    Ok(url)
}
fn raster(bytes: &[u8]) -> Result<String, String> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
    if !matches!(reader.format(), Some(image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::Gif | image::ImageFormat::WebP)) {
        return Err("Hanya PNG/JPEG/GIF/WebP yang didukung; SVG ditolak".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|e| e.to_string())?;
    let mut png = Cursor::new(Vec::new());
    decoded.write_to(&mut png, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    if png.get_ref().len() > MAX_OUTPUT { return Err("Hasil gambar terlalu besar".into()); }
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png.into_inner())))
}
fn download(raw: &str) -> Result<String, String> {
    let _guard = DOWNLOAD.try_lock().map_err(|_| "Pemuatan gambar lain masih berjalan")?;
    let url = parse_url(raw)?;
    let host = url.host_str().unwrap();
    // Resolve once, reject non-public IPv4, and pin the exact addresses used
    // by the TLS client. IPv6-only hosts are deliberately unsupported for now.
    let resolved = resolve_host(host.to_owned())?;
    let mut addresses = Vec::new();
    for address in resolved {
        if let IpAddr::V4(ip) = address.ip() {
            if !public_v4(ip) { return Err("Alamat privat/reserved tidak diizinkan".into()); }
            addresses.push(SocketAddr::new(IpAddr::V4(ip), 443));
        }
    }
    if addresses.is_empty() { return Err("Diperlukan tujuan IPv4 publik".into()); }
    let client = Client::builder().no_proxy().redirect(Policy::none())
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(15))
        .resolve_to_addrs(host, &addresses).build().map_err(|e| e.to_string())?;
    let response = client.get(url).header("Accept", "image/png,image/jpeg,image/gif,image/webp")
        .send().map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err("HTTP gagal atau redirect ditolak".into()); }
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok())
        .unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp") {
        return Err("Content-Type gambar tidak didukung".into());
    }
    if response.content_length().is_some_and(|n| n > MAX_INPUT) { return Err("Gambar melebihi 5 MB".into()); }
    let mut bytes = Vec::new();
    response.take(MAX_INPUT + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_INPUT { return Err("Gambar melebihi 5 MB".into()); }
    raster(&bytes)
}
#[tauri::command]
pub async fn download_image(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download(&url)).await.map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_reserved_targets_and_unsafe_urls() {
        for ip in ["0.0.0.0","10.1.2.3","127.0.0.1","100.64.0.1","169.254.169.254","172.16.0.1","192.168.0.1","192.0.2.1","198.18.0.1","203.0.113.1","224.0.0.1","255.255.255.255"] {
            assert!(!public_v4(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_v4("8.8.8.8".parse().unwrap()));
        for url in ["http://example.com/a.png","https://u:p@example.com/a","https://example.com:444/a","file:///tmp/a"] { assert!(parse_url(url).is_err()); }
    }
    #[test]
    fn rejects_svg_and_reencodes_raster() {
        assert!(raster(b"<svg xmlns='http://www.w3.org/2000/svg'/>").is_err());
        let img = image::DynamicImage::new_rgb8(1,1);
        let mut input = Cursor::new(Vec::new());
        img.write_to(&mut input, image::ImageFormat::Png).unwrap();
        assert!(raster(input.get_ref()).unwrap().starts_with("data:image/png;base64,"));
    }
    #[test]
    fn dns_timeout_does_not_allow_unbounded_workers() {
        let busy = Arc::new(AtomicBool::new(false));
        let (release, blocked) = mpsc::channel();
        let result = resolve_with_timeout(busy.clone(), Duration::from_millis(30), move || {
            blocked.recv().unwrap();
            Ok(vec![])
        });
        assert!(result.unwrap_err().contains("batas waktu"));
        assert!(busy.load(Ordering::Acquire));
        // A timed-out resolver is still running: no second worker may start.
        assert!(resolve_with_timeout(busy, Duration::from_secs(1), || panic!("must not spawn"))
            .unwrap_err().contains("masih berjalan"));
        release.send(()).unwrap();
    }
    #[test]
    fn dns_success_and_failure_release_the_slot() {
        let busy = Arc::new(AtomicBool::new(false));
        let expected: SocketAddr = "8.8.8.8:443".parse().unwrap();
        let addresses = resolve_with_timeout(busy.clone(), Duration::from_secs(5), move || Ok(vec![expected])).unwrap();
        assert_eq!(addresses, vec![expected]);
        assert!(!busy.load(Ordering::Acquire));
        assert!(resolve_with_timeout(busy.clone(), Duration::from_secs(5), || Err("DNS failed".into())).is_err());
        assert!(!busy.load(Ordering::Acquire));
        assert_eq!(resolve_host("127.0.0.1".into()).unwrap()[0].ip(), "127.0.0.1".parse::<IpAddr>().unwrap());
        // Target validation remains in download(), after resolution.
    }

}
