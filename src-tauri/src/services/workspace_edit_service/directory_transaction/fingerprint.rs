use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

pub(super) fn directory_fingerprint(path: &Path) -> Result<String, String> {
    let mut hash = FNV_OFFSET_BASIS;
    hash_path(path, &mut hash)?;
    Ok(format!("{hash:016x}"))
}

fn hash_path(path: &Path, hash: &mut u64) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        hash_bytes(hash, b"link\0");
        let target = fs::read_link(path).map_err(|error| error.to_string())?;
        hash_bytes(hash, target.to_string_lossy().as_bytes());
        return Ok(());
    }
    if metadata.is_file() {
        hash_bytes(hash, b"file\0");
        let mut file = File::open(path).map_err(|error| error.to_string())?;
        let mut buffer = [0_u8; 8192];
        loop {
            let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            hash_bytes(hash, &buffer[..read]);
        }
        return Ok(());
    }
    if !metadata.is_dir() {
        return Err(format!(
            "Workspace directory fingerprint found an unsupported entry: {}",
            path.display()
        ));
    }

    hash_bytes(hash, b"directory\0");
    let mut entries = fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        hash_bytes(hash, b"entry\0");
        hash_bytes(hash, entry.file_name().to_string_lossy().as_bytes());
        hash_bytes(hash, b"\0");
        hash_path(&entry.path(), hash)?;
    }
    Ok(())
}

fn hash_bytes(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(FNV_PRIME);
    }
}
