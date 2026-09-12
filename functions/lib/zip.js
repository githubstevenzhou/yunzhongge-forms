// 最小 ZIP 编码器（stored 模式，无压缩）
// 不依赖任何第三方库，Cloudflare Workers 原生可跑

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n) {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

// files: [{ name: string, data: Uint8Array }]
export function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    // 本地文件头（30 字节固定 + 文件名）
    const localHeader = [
      0x50, 0x4b, 0x03, 0x04, // 签名
      ...u16(20), // 解压所需版本
      ...u16(0x0800),  // 标志位：bit11=1 表示文件名用 UTF-8 编码
      ...u16(0),  // 压缩方式：0=stored
      ...u16(0), ...u16(0), // 修改时间、日期
      ...u32(crc),
      ...u32(size), // 压缩后大小
      ...u32(size), // 原始大小
      ...u16(nameBytes.length),
      ...u16(0), // 额外字段长度
    ];
    localChunks.push(new Uint8Array(localHeader));
    localChunks.push(nameBytes);
    localChunks.push(f.data);

    // 中央目录头（46 字节固定 + 文件名）
    const centralHeader = [
      0x50, 0x4b, 0x01, 0x02, // 签名
      ...u16(20), // 制作版本
      ...u16(20), // 解压所需版本
      ...u16(0x0800),  // 标志位：bit11=1 表示文件名用 UTF-8 编码
      ...u16(0),  // 压缩方式
      ...u16(0), ...u16(0),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0), // 额外
      ...u16(0), // 注释长度
      ...u16(0), // 起始磁盘号
      ...u16(0), // 内部属性
      ...u32(0), // 外部属性
      ...u32(offset), // 本地头偏移
    ];
    centralChunks.push(new Uint8Array(centralHeader));
    centralChunks.push(nameBytes);

    offset += localHeader.length + nameBytes.length + size;
  }

  const centralSize = centralChunks.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;

  const endRecord = [
    0x50, 0x4b, 0x05, 0x06, // 签名
    ...u16(0), ...u16(0), // 磁盘号
    ...u16(files.length), ...u16(files.length), // 条目数
    ...u32(centralSize),
    ...u32(centralOffset),
    ...u16(0), // 注释长度
  ];

  return new Blob(
    [...localChunks, ...centralChunks, new Uint8Array(endRecord)],
    { type: 'application/zip' }
  );
}

// 把文件名里的非法字符替换掉，避免 ZIP 内路径出错
export function safeName(s) {
  return String(s == null ? 'unknown' : s)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || 'unknown';
}

// content-type -> 扩展名
export function extFromType(ct) {
  const m = /image\/(\w+)/.exec(ct || '');
  if (!m) return 'jpg';
  const t = m[1].toLowerCase();
  if (t === 'jpeg') return 'jpg';
  return t; // png / webp / jpg ...
}
