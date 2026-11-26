import {parseCSV} from './data.js';
import {icon} from './icons.js';

const CSV_URL = new URL('../shanghai_pudong_4h_cities.csv', import.meta.url);
const STORE_KEY = 'raven.paper.city';
const CITY_TEXT_KEYS = ['省份', '地级市', '目的地', '行政级别', '推荐方式', '最快门到门耗时(小时)', '高铁门到门预计耗时(小时)', '顺风车门到门预计耗时(小时)', '是否压线(约3.8-4h)', '主要出发站或高速路线', '特色与出行备注'];

let rowsPromise = null;
let sceneCounter = 0;

function stored(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore quota */ }
}
function randomIndex(length, last = -1) {
  if (length < 2) return 0;
  let n;
  do {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    n = a[0] % length;
  } while (n === last);
  return n;
}

function loadCities() {
  if (!rowsPromise) {
    rowsPromise = fetch(CSV_URL, {cache: 'no-cache'})
      .then(response => {
        if (!response.ok) throw new Error(`cities ${response.status}`);
        return response.text();
      })
      .then(parseCSV);
    rowsPromise.catch(() => { rowsPromise = null; });
  }
  return rowsPromise;
}

/* ---------- paper-theatre illustration ---------- */

const C = {
  skyTop: '#b5bfba', skyBot: '#d1cabc',
  sun: '#efdcc0',
  far: '#aab3aa', mid: '#8ea098', near: '#74877e',
  waterTop: '#bcc7c3', waterMid: '#a5b5b3', waterBot: '#91a5a4',
  wall: '#cdc6b8', roof: '#67586a', roofDark: '#4f4353',
  ink: '#493747', warm: '#c9a487', lit: '#e4cda6',
  foliage: '#5f7468', foliageLight: '#7d9185', grass: '#697d70'
};

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeRand(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function archetype(city) {
  const text = `${city['目的地'] || ''} ${city['地级市'] || ''} ${city['特色与出行备注'] || ''}`;
  const has = list => list.some(word => text.includes(word));
  if (has(['寺', '庙', '塔', '佛', '圣坛', '祠', '普陀'])) return 'temple';
  if (has(['列岛', '海岛', '海岛县', '渔港', '沙滩', '看日出', '码头', '嵊泗', '岱山', '象山', '朱家尖', '启东', '吕四'])) return 'sea';
  if (has(['山', '峰', '竹', '竹林', '梯田', '森林', '峡谷', '丹霞', '温泉', '漂流', '古村', '瀑布', '岩'])) return 'mountain';
  if (has(['古镇', '水乡', '老街', '桥', '溪', '运河', '弄', '太平湖'])) return 'watertown';
  if (has(['湖', '千岛', '湿地', '滩涂'])) return 'lake';
  if (has(['园林', '拙政', '留园', '狮子林', '个园', '何园', '宅'])) return 'garden';
  if (has(['影视', '横店', '市区', '城区', '城', '街', '广场', '新区'])) return 'skyline';
  return 'hills';
}

function ridgePath(rand, baseY, amp, step) {
  const points = [];
  let x = -60;
  while (x < 900) {
    points.push([x, baseY - amp * (0.28 + rand() * 0.72)]);
    x += step * (0.65 + rand() * 0.8);
  }
  let d = `M -60 470 L -60 ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${points[i][0].toFixed(1)} ${points[i][1].toFixed(1)}`;
  d += ' L 900 470 Z';
  return d;
}

function pine(x, y, s, fill) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}">
    <rect x="-2" y="-4" width="4" height="16"/>
    <path d="M0 -46 L16 -18 L6 -18 L20 2 L-20 2 L-6 -18 L-16 -18 Z"/>
  </g>`;
}
function roundTree(x, y, s, fill, trunk) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-2.4" y="-10" width="4.8" height="24" fill="${trunk}"/>
    <circle cx="0" cy="-20" r="17" fill="${fill}"/>
    <circle cx="-12" cy="-12" r="11" fill="${fill}"/>
    <circle cx="12" cy="-13" r="12" fill="${fill}"/>
  </g>`;
}
function boat(x, y, s, flip = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})">
    <path d="M-30 0 Q0 12 30 0 L24 9 Q0 16 -24 9 Z" fill="${C.ink}" opacity=".82"/>
    <line x1="2" y1="0" x2="2" y2="-34" stroke="${C.ink}" stroke-width="2" opacity=".8"/>
    <path d="M4 -33 Q26 -18 4 -2 Z" fill="${C.wall}" opacity=".92"/>
    <path d="M-2 -30 Q-16 -16 -2 -3 Z" fill="${C.wall}" opacity=".7"/>
  </g>`;
}
function birds(rand, x, y) {
  let out = '';
  for (let i = 0; i < 4; i++) {
    const bx = x + (rand() - 0.5) * 120;
    const by = y + (rand() - 0.5) * 50;
    const w = 5 + rand() * 4;
    out += `<path d="M${(bx - w).toFixed(1)} ${by.toFixed(1)} Q${(bx - w / 2).toFixed(1)} ${(by - w / 2).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)} Q${(bx + w / 2).toFixed(1)} ${(by - w / 2).toFixed(1)} ${(bx + w).toFixed(1)} ${by.toFixed(1)}" fill="none" stroke="${C.ink}" stroke-width="1.2" opacity=".4" stroke-linecap="round"/>`;
  }
  return out;
}
function pagoda(cx, baseY, tiers, scale) {
  const tierH = 32 * scale;
  let parts = [];
  for (let i = 0; i < tiers; i++) {
    const y = baseY - i * tierH;
    const shrink = 1 - i * 0.12;
    const bw = 15 * scale * shrink;
    const rw = 34 * scale * shrink;
    const rh = 20 * scale;
    const bodyTop = y - tierH * 0.62;
    parts.push(`<rect x="${(cx - bw).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${(bw * 2).toFixed(1)}" height="${(tierH * 0.62).toFixed(1)}" fill="${C.roofDark}"/>`);
    parts.push(`<path d="M${(cx - rw).toFixed(1)} ${bodyTop.toFixed(1)} Q${(cx - rw * 0.5).toFixed(1)} ${(bodyTop + 2).toFixed(1)} ${(cx - rw * 0.22).toFixed(1)} ${(bodyTop - rh).toFixed(1)} L${(cx + rw * 0.22).toFixed(1)} ${(bodyTop - rh).toFixed(1)} Q${(cx + rw * 0.5).toFixed(1)} ${(bodyTop + 2).toFixed(1)} ${(cx + rw).toFixed(1)} ${bodyTop.toFixed(1)} Q${cx.toFixed(1)} ${(bodyTop + 5).toFixed(1)} ${(cx - rw).toFixed(1)} ${bodyTop.toFixed(1)} Z" fill="${C.roof}"/>`);
  }
  const topY = baseY - tiers * tierH;
  parts.push(`<line x1="${cx}" y1="${(topY - tierH * 0.4).toFixed(1)}" x2="${cx}" y2="${(topY - tierH * 0.4 - 30 * scale).toFixed(1)}" stroke="${C.roof}" stroke-width="${(2 * scale).toFixed(1)}"/>`);
  parts.push(`<circle cx="${cx}" cy="${(topY - tierH * 0.4 - 32 * scale).toFixed(1)}" r="${(2.6 * scale).toFixed(1)}" fill="${C.warm}"/>`);
  return `<g>${parts.join('')}</g>`;
}

function baseSky(uid, rand) {
  const sunX = 200 + rand() * 400;
  const sunY = 96 + rand() * 40;
  const sunR = 58 + rand() * 26;
  return `<defs>
    <linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.skyTop}"/>
      <stop offset="1" stop-color="${C.skyBot}"/>
    </linearGradient>
    <radialGradient id="sun-${uid}" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${C.sun}" stop-opacity=".95"/>
      <stop offset="1" stop-color="${C.sun}" stop-opacity=".35"/>
    </radialGradient>
    <linearGradient id="water-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.waterTop}"/>
      <stop offset="1" stop-color="${C.waterBot}"/>
    </linearGradient>
    <radialGradient id="vig-${uid}" cx="50%" cy="46%" r="64%">
      <stop offset=".55" stop-color="#3b2f3d" stop-opacity="0"/>
      <stop offset="1" stop-color="#3b2f3d" stop-opacity=".18"/>
    </radialGradient>
  </defs>
  <rect width="800" height="450" fill="url(#sky-${uid})"/>
  <circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="url(#sun-${uid})"/>`;
}
function grain(uid) {
  return `<rect width="800" height="450" fill="url(#vig-${uid})"/>`;
}

function sceneSea(uid, rand) {
  const horizon = 288;
  let s = '';
  s += `<path d="${ridgePath(rand, horizon + 6, 26, 150)}" fill="${C.far}" opacity=".65"/>`;
  s += `<path d="${ridgePath(rand, horizon + 6, 14, 110)}" fill="${C.mid}" opacity=".55"/>`;
  s += `<rect x="0" y="${horizon}" width="800" height="${450 - horizon}" fill="url(#water-${uid})"/>`;
  s += `<ellipse cx="400" cy="${horizon + 70}" rx="150" ry="40" fill="${C.sun}" opacity=".14"/>`;
  const ix = 500 + rand() * 150;
  s += `<g><path d="M${ix - 110} ${horizon + 4} Q${ix - 60} ${horizon - 54} ${ix} ${horizon - 30} Q${ix + 70} ${horizon - 64} ${ix + 130} ${horizon + 4} Z" fill="${C.foliage}" opacity=".85"/>
    ${pine(ix - 34, horizon - 14, 0.8, C.near)}${pine(ix + 26, horizon - 8, 0.62, C.near)}</g>`;
  for (let i = 0; i < 7; i++) {
    const wy = horizon + 26 + i * 20 + rand() * 8;
    const wx = 40 + rand() * 240;
    const ww = 60 + rand() * 130;
    s += `<path d="M${wx.toFixed(1)} ${wy.toFixed(1)} q${(ww / 4).toFixed(1)} -6 ${(ww / 2).toFixed(1)} 0 t${(ww / 2).toFixed(1)} 0" fill="none" stroke="${C.wall}" stroke-width="1.4" opacity=".45"/>`;
  }
  s += boat(215, horizon + 92, 0.95);
  s += `<g stroke="${C.grass}" stroke-width="2" fill="none" opacity=".8" stroke-linecap="round">
    ${Array.from({ length: 8 }, (_, i) => {
      const x = 30 + i * 10 + rand() * 6;
      return `<path d="M${x.toFixed(1)} 450 Q${(x + (rand() - 0.5) * 10).toFixed(1)} 410 ${(x + (rand() - 0.5) * 16).toFixed(1)} 384"/>`;
    }).join('')}
  </g>`;
  s += birds(rand, 300, 120);
  return s;
}

function sceneMountain(uid, rand) {
  let s = '';
  s += `<path d="${ridgePath(rand, 300, 150, 120)}" fill="${C.far}" opacity=".8"/>`;
  s += `<path d="${ridgePath(rand, 340, 120, 100)}" fill="${C.mid}" opacity=".9"/>`;
  s += `<path d="${ridgePath(rand, 380, 90, 90)}" fill="${C.near}"/>`;
  s += `<ellipse cx="400" cy="250" rx="360" ry="34" fill="${C.wall}" opacity=".18"/>`;
  for (let i = 0; i < 9; i++) {
    const x = 90 + rand() * 620;
    s += `<path d="M${x.toFixed(1)} 380 q${(rand() - 0.5) * 40} -60 ${(rand() - 0.5) * 80} -110" stroke="${C.far}" stroke-width="1.1" opacity=".35" fill="none"/>`;
  }
  s += pine(70, 430, 1.5, C.foliage) + pine(732, 438, 1.2, C.foliage);
  s += `<path d="M0 450 Q120 420 240 436 T480 442 T800 430 L800 450 Z" fill="${C.grass}" opacity=".85"/>`;
  s += birds(rand, 330, 130);
  return s;
}

function sceneWatertown(uid, rand) {
  const waterY = 306;
  let s = '';
  s += `<path d="${ridgePath(rand, waterY, 30, 150)}" fill="${C.far}" opacity=".55"/>`;
  s += `<rect x="0" y="${waterY}" width="800" height="${450 - waterY}" fill="url(#water-${uid})"/>`;
  const houses = [
    { x: 40, w: 96, h: 58 }, { x: 146, w: 84, h: 46 }, { x: 512, w: 92, h: 54 }, { x: 614, w: 108, h: 64 }, { x: 730, w: 70, h: 44 }
  ];
  for (const ho of houses) {
    const top = waterY - ho.h;
    s += `<rect x="${ho.x}" y="${top}" width="${ho.w}" height="${ho.h}" fill="${C.wall}" opacity=".92"/>`;
    s += `<path d="M${ho.x - 10} ${top} Q${ho.x + ho.w / 2} ${top - 24} ${ho.x + ho.w + 10} ${top} Z" fill="${C.roof}"/>`;
    for (let wi = 0; wi < 3; wi++) {
      s += `<rect x="${ho.x + 14 + wi * 24}" y="${top + 20}" width="10" height="14" fill="${C.roofDark}" opacity=".55"/>`;
    }
    s += `<rect x="${ho.x}" y="${waterY}" width="${ho.w}" height="${ho.h * 0.5}" fill="${C.wall}" opacity=".12"/>`;
  }
  s += `<path d="M250 ${waterY} L250 ${waterY - 34} Q360 ${waterY - 66} 470 ${waterY - 34} L470 ${waterY} L440 ${waterY} Q360 ${waterY - 6} 280 ${waterY} Z" fill="${C.roof}" opacity=".94"/>`;
  s += `<path d="M300 ${waterY} Q360 ${waterY - 30} 420 ${waterY} Z" fill="${C.waterBot}"/>`;
  s += `<path d="M250 ${waterY - 34} Q360 ${waterY - 66} 470 ${waterY - 34}" fill="none" stroke="${C.roofDark}" stroke-width="2" opacity=".6"/>`;
  s += boat(560, waterY + 82, 0.72, -1);
  s += `<g stroke="${C.foliage}" stroke-width="1.6" fill="none" opacity=".85" stroke-linecap="round">
    <path d="M64 400 L64 300"/><path d="M64 320 Q30 300 18 340"/><path d="M64 330 Q98 306 108 348"/><path d="M64 350 Q26 340 20 384"/><path d="M64 360 Q104 348 110 392"/>
  </g>`;
  s += birds(rand, 430, 120);
  return s;
}

function sceneLake(uid, rand) {
  const waterY = 252;
  let s = '';
  s += `<path d="${ridgePath(rand, waterY + 4, 44, 130)}" fill="${C.far}" opacity=".7"/>`;
  s += `<path d="${ridgePath(rand, waterY + 4, 22, 110)}" fill="${C.mid}" opacity=".7"/>`;
  s += `<rect x="0" y="${waterY}" width="800" height="${450 - waterY}" fill="url(#water-${uid})"/>`;
  s += `<ellipse cx="410" cy="${waterY + 70}" rx="210" ry="46" fill="${C.sun}" opacity=".12"/>`;
  const ix = 540 + rand() * 90;
  s += `<path d="M${ix - 120} ${waterY + 2} Q${ix - 80} ${waterY - 34} ${ix - 20} ${waterY - 22} Q${ix + 50} ${waterY - 42} ${ix + 120} ${waterY + 2} Z" fill="${C.foliage}" opacity=".9"/>`;
  s += pagoda(ix, waterY - 20, 3, 0.6);
  for (let i = 0; i < 6; i++) {
    const y = waterY + 30 + i * 26;
    s += `<path d="M${(160 + rand() * 120).toFixed(1)} ${y.toFixed(1)} h${(90 + rand() * 80).toFixed(1)}" stroke="${C.wall}" stroke-width="1.4" opacity=".4"/>`;
  }
  s += boat(250, waterY + 120, 0.8);
  s += `<g stroke="${C.grass}" stroke-width="2.2" fill="none" opacity=".85" stroke-linecap="round">
    ${Array.from({ length: 10 }, (_, i) => {
      const x = 700 + i * 9 + rand() * 5;
      return `<path d="M${x.toFixed(1)} 450 Q${(x + (rand() - 0.5) * 8).toFixed(1)} 408 ${(x + (rand() - 0.5) * 14).toFixed(1)} 372"/>`;
    }).join('')}
  </g>`;
  s += birds(rand, 300, 110);
  return s;
}

function sceneSkyline(uid, rand) {
  let s = '';
  s += `<path d="${ridgePath(rand, 300, 36, 140)}" fill="${C.far}" opacity=".6"/>`;
  let x = -20;
  while (x < 820) {
    const w = 42 + rand() * 62;
    const h = 40 + rand() * 90;
    s += `<rect x="${x.toFixed(1)}" y="${(330 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${C.far}" opacity=".55"/>`;
    x += w + 6;
  }
  x = 10;
  while (x < 800) {
    const w = 52 + rand() * 70;
    const h = 70 + rand() * 120;
    const top = 372 - h;
    s += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${(372 - top).toFixed(1)}" fill="${C.roof}"/>`;
    for (let wy = top + 12; wy < 360; wy += 18) {
      for (let wx = x + 8; wx < x + w - 8; wx += 16) {
        if (rand() > 0.45) s += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="5" height="7" fill="${C.lit}" opacity=".55"/>`;
      }
    }
    x += w + 10 + rand() * 18;
  }
  const tx = 330 + rand() * 140;
  s += `<g><rect x="${tx - 12}" y="196" width="24" height="176" fill="${C.roofDark}"/>
    <rect x="${tx - 24}" y="220" width="48" height="10" fill="${C.roof}"/>
    <rect x="${tx - 20}" y="250" width="40" height="8" fill="${C.roof}"/>
    <rect x="${tx - 16}" y="280" width="32" height="7" fill="${C.roof}"/>
    <line x1="${tx}" y1="196" x2="${tx}" y2="170" stroke="${C.roofDark}" stroke-width="2"/>
    <circle cx="${tx}" cy="168" r="3" fill="${C.warm}"/></g>`;
  s += `<path d="M0 400 Q120 378 240 392 T480 396 T800 386 L800 450 L0 450 Z" fill="${C.grass}" opacity=".75"/>`;
  s += roundTree(120, 420, 1.1, C.foliage, C.roofDark) + roundTree(690, 424, 1.3, C.foliage, C.roofDark);
  s += birds(rand, 520, 120);
  return s;
}

function sceneTemple(uid, rand) {
  let s = '';
  s += `<path d="${ridgePath(rand, 320, 70, 130)}" fill="${C.far}" opacity=".65"/>`;
  s += `<path d="${ridgePath(rand, 366, 54, 120)}" fill="${C.mid}" opacity=".8"/>`;
  s += `<path d="${ridgePath(rand, 404, 34, 140)}" fill="${C.near}"/>`;
  s += `<ellipse cx="360" cy="300" rx="330" ry="28" fill="${C.wall}" opacity=".18"/>`;
  s += pagoda(540, 392, 5, 0.95);
  s += pine(150, 420, 1.5, C.foliage) + pine(228, 428, 1.05, C.foliage);
  s += `<path d="M0 450 Q140 424 280 438 T560 442 T800 430 L800 450 Z" fill="${C.grass}" opacity=".8"/>`;
  s += `<path d="M640 380 q-18 -22 6 -40 q20 -16 4 -36" fill="none" stroke="${C.wall}" stroke-width="2.4" opacity=".5" stroke-linecap="round"/>`;
  s += birds(rand, 300, 118);
  return s;
}

function sceneGarden(uid, rand) {
  let s = '';
  s += `<path d="${ridgePath(rand, 300, 34, 160)}" fill="${C.far}" opacity=".55"/>`;
  s += `<path d="${ridgePath(rand, 330, 20, 130)}" fill="${C.mid}" opacity=".5"/>`;
  s += `<g>${roundTree(600, 300, 1.3, C.foliage, C.roofDark)}${pine(180, 308, 1.1, C.foliageLight)}</g>`;
  const gateX = 380, gateR = 96, wallTop = 224, wallBottom = 396;
  s += `<path fill-rule="evenodd" d="M0 ${wallTop} L800 ${wallTop} L800 ${wallBottom} L0 ${wallBottom} Z M${gateX - gateR} 340 A${gateR} ${gateR} 0 1 0 ${gateX + gateR} 340 A${gateR} ${gateR} 0 1 0 ${gateX - gateR} 340 Z" fill="${C.wall}"/>`;
  s += `<circle cx="${gateX}" cy="340" r="${gateR}" fill="none" stroke="${C.roof}" stroke-width="4" opacity=".5"/>`;
  s += `<g>${roundTree(gateX - 10, 356, 0.7, C.foliage, C.roofDark)}${pine(gateX + 34, 372, 0.55, C.foliage)}</g>`;
  s += `<path d="M0 ${wallTop} L800 ${wallTop}" stroke="${C.roof}" stroke-width="7"/>
    <path d="M-10 ${wallTop} Q40 ${wallTop - 18} 90 ${wallTop} T200 ${wallTop} T320 ${wallTop} T440 ${wallTop} T560 ${wallTop} T680 ${wallTop} T810 ${wallTop}" fill="none" stroke="${C.roof}" stroke-width="4" opacity=".8"/>`;
  for (let i = 0; i < 5; i++) {
    const sx = 140 + i * 130;
    s += `<ellipse cx="${sx}" cy="${424 + rand() * 8}" rx="${16 + rand() * 8}" ry="5" fill="${C.roofDark}" opacity=".35"/>`;
  }
  s += `<path d="M0 450 Q160 430 320 440 T640 442 T800 434 L800 450 Z" fill="${C.grass}" opacity=".8"/>`;
  return s;
}

function sceneHills(uid, rand) {
  let s = '';
  s += `<path d="${ridgePath(rand, 296, 60, 150)}" fill="${C.far}" opacity=".7"/>`;
  s += `<path d="${ridgePath(rand, 336, 44, 130)}" fill="${C.mid}" opacity=".85"/>`;
  s += `<path d="${ridgePath(rand, 378, 30, 150)}" fill="${C.near}"/>`;
  s += `<path d="M0 450 Q160 410 320 432 T640 430 T800 418 L800 450 Z" fill="${C.grass}" opacity=".85"/>`;
  s += roundTree(560, 410, 1.75, C.foliage, C.roofDark);
  s += roundTree(150, 426, 1.15, C.foliageLight, C.roofDark);
  s += birds(rand, 320, 120);
  return s;
}

const SCENES = {
  sea: sceneSea, mountain: sceneMountain, watertown: sceneWatertown,
  lake: sceneLake, skyline: sceneSkyline, temple: sceneTemple,
  garden: sceneGarden, hills: sceneHills
};

export function cityScene(city) {
  const seed = hashSeed(`${city['目的地']}|${city['地级市']}|${city['省份']}`);
  const rand = makeRand(seed);
  const uid = `sc${++sceneCounter}-${(seed % 46656).toString(36)}`;
  const kind = archetype(city);
  const draw = SCENES[kind] || sceneHills;
  const body = draw(uid, rand);
  return `<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${escapeAttr(city['目的地'] || '')}">
    ${baseSky(uid, rand)}
    ${body}
    ${grain(uid)}
  </svg>`;
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
}

/* ---------- data formatting ---------- */

function methodLabel(city) {
  const raw = (city['推荐方式'] || '').trim();
  if (raw === '双选') return '高铁 / 顺风车';
  if (raw) return raw;
  if (city['高铁门到门预计耗时(小时)']) return '高铁';
  if (city['顺风车门到门预计耗时(小时)']) return '顺风车';
  return '—';
}
function breakdownLabel(city) {
  const parts = [];
  const hi = city['高铁门到门预计耗时(小时)'];
  const car = city['顺风车门到门预计耗时(小时)'];
  if (hi) parts.push(`高铁 ${hi}h`);
  if (car) parts.push(`顺风车 ${car}h`);
  return parts.length > 1 ? parts.join(' · ') : '';
}
function timeLabel(city) {
  const t = city['最快门到门耗时(小时)'];
  return t ? `${t} 小时` : '—';
}

/* ---------- mount ---------- */

export async function mountCity(container) {
  container.replaceChildren();
  const sheet = document.createElement('section');
  sheet.className = 'city-sheet';
  container.append(sheet);

  let rows;
  try {
    rows = await loadCities();
  } catch (error) {
    const box = document.createElement('div');
    box.className = 'quiet-error';
    const retry = document.createElement('button');
    retry.className = 'paper-control';
    retry.type = 'button';
    retry.setAttribute('aria-label', '重试');
    retry.innerHTML = icon('refresh');
    retry.addEventListener('click', () => mountCity(container));
    box.append(retry);
    sheet.replaceChildren(box);
    return;
  }
  if (!rows.length) return;

  const sceneWrap = document.createElement('figure');
  sceneWrap.className = 'city-scene';
  const art = document.createElement('div');
  art.className = 'city-art';
  sceneWrap.append(art);

  const info = document.createElement('div');
  info.className = 'city-info';
  info.setAttribute('aria-live', 'polite');
  const region = document.createElement('p'); region.className = 'city-region';
  const name = document.createElement('h1'); name.className = 'city-name';
  const facts = document.createElement('dl'); facts.className = 'city-facts';
  const methodRow = document.createElement('div');
  const methodDt = document.createElement('dt'); methodDt.textContent = '出行方式';
  const methodDd = document.createElement('dd'); methodDd.className = 'f-method';
  methodRow.append(methodDt, methodDd);
  const timeRow = document.createElement('div');
  const timeDt = document.createElement('dt'); timeDt.textContent = '预计时间';
  const timeDd = document.createElement('dd'); timeDd.className = 'f-time';
  timeRow.append(timeDt, timeDd);
  facts.append(methodRow, timeRow);
  const breakdown = document.createElement('p'); breakdown.className = 'city-breakdown';
  const route = document.createElement('p'); route.className = 'city-route';
  const note = document.createElement('p'); note.className = 'city-note';
  const actions = document.createElement('div'); actions.className = 'city-actions';
  const badge = document.createElement('span'); badge.className = 'city-badge';
  const refresh = document.createElement('button');
  refresh.className = 'paper-control'; refresh.type = 'button'; refresh.setAttribute('aria-label', '换一个城市');
  refresh.innerHTML = icon('refresh');
  const map = document.createElement('a');
  map.className = 'paper-control'; map.target = '_blank'; map.rel = 'noopener noreferrer'; map.setAttribute('aria-label', '查看城市地图');
  map.innerHTML = icon('external');
  actions.append(refresh, map, badge);
  info.append(region, name, facts, breakdown, route, note, actions);
  sheet.append(sceneWrap, info);

  const saved = stored(STORE_KEY);
  let index = rows.findIndex(row => row['目的地'] === saved);
  if (index < 0) index = randomIndex(rows.length);

  function render() {
    const city = rows[index];
    save(STORE_KEY, city['目的地']);
    region.textContent = [city['省份'], city['地级市'], city['行政级别']].filter(Boolean).join(' · ');
    name.textContent = city['目的地'] || '';
    methodDd.textContent = methodLabel(city);
    timeDd.textContent = timeLabel(city);
    const extra = breakdownLabel(city);
    breakdown.textContent = extra;
    breakdown.hidden = !extra;
    route.textContent = city['主要出发站或高速路线'] ? `主要出发站 / 路线：${city['主要出发站或高速路线']}` : '';
    route.hidden = !city['主要出发站或高速路线'];
    note.textContent = city['特色与出行备注'] ? `备注：${city['特色与出行备注']}` : '';
    note.hidden = !city['特色与出行备注'];
    const pressed = city['是否压线(约3.8-4h)'] === '是';
    badge.hidden = !pressed;
    badge.textContent = pressed ? '约 4 小时压线' : '';
    const query = [city['目的地'], city['地级市'], city['省份'], '中国'].filter(Boolean).join(' ');
    map.href = 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(query);
    art.innerHTML = cityScene(city);
  }

  refresh.addEventListener('click', () => { index = randomIndex(rows.length, index); render(); });
  render();
}
