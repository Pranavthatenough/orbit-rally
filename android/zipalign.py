"""Minimal zipalign: rewrites an APK so every uncompressed file starts on a
4-byte boundary (.so files on 4096). Android 11+ refuses apps whose
resources.arsc is not stored uncompressed and aligned."""
import sys, zipfile

src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
infos = zin.infolist()
# resources.arsc must be stored (not compressed)
store = lambda n: n == 'resources.arsc' or n.endswith(('.png', '.woff2'))
with open(dst, 'wb') as f:
    zout = zipfile.ZipFile(f, 'w')
    for info in infos:
        data = zin.read(info.filename)
        ni = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        ni.external_attr = info.external_attr
        ni.compress_type = zipfile.ZIP_STORED if store(info.filename) else zipfile.ZIP_DEFLATED
        if ni.compress_type == zipfile.ZIP_STORED:
            align = 4096 if info.filename.endswith('.so') else 4
            # header = 30 bytes + name + extra; pad extra so data offset is aligned
            offset = f.tell() + 30 + len(ni.filename.encode())
            pad = (-offset) % align
            ni.extra = b'\x00' * pad
        zout.writestr(ni, data)
    zout.close()

# verify
z = zipfile.ZipFile(dst)
for i in z.infolist():
    if i.compress_type == zipfile.ZIP_STORED:
        off = i.header_offset + 30 + len(i.filename.encode()) + len(i.extra)
        assert off % 4 == 0, i.filename
print('aligned', dst)
