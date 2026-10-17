import type { BgTask, ChatLine, OfficeAgent, OfficeStats, Theme, Usage } from '../types'
import { KIND_LABEL, STATUS_COLOR, activityLine, character, clip, fmtAge, levelOf, localSeconds, phaseOf, subtitle } from './office'
import type { Character, DeskItem, Phase } from './office'
import { CHAT_SHOW_MS, GREET_MS, MAX_DESKS, MX, MY, STEP_X, STEP_Y, layout, stageActors, standing } from './stage'
import type { Actor, Layout, Leg as StageLeg } from './stage'
import type { Stage } from '../types'

// An isometric office. World units: x runs to the lower right, y to the lower
// left, z up; a point lands on screen at (x - y, (x + y) / 2 - z).

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c)

const f = (n: number): string => String(Math.round(n * 2) / 2)

const P = (x: number, y: number, z: number): [number, number] => [x - y, (x + y) / 2 - z]

const r = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra ? ' ' + extra : ''}/>`

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1, 7), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)))
  const out = (ch(n >> 16) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255)
  return '#' + out.toString(16).padStart(6, '0')
}

function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

type V3 = [number, number, number]

function poly(pts: V3[], fill: string, extra = ''): string {
  const s = pts
    .map(([x, y, z]) => {
      const [a, b] = P(x, y, z)
      return f(a) + ',' + f(b)
    })
    .join(' ')
  return `<polygon points="${s}" fill="${fill}"${extra ? ' ' + extra : ''}/>`
}

type Faces = { top?: string; front?: string; side?: string }

/** A solid: its top, the face toward +y (lower left) and the face toward +x (lower right). */
function box(x: number, y: number, z: number, w: number, d: number, h: number, color: string, faces: Faces = {}): string {
  return (
    poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], faces.top ?? shade(color, 0.08)) +
    poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], faces.front ?? color) +
    poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], faces.side ?? shade(color, -0.15))
  )
}

function mat(a: number, b: number, c: number, d: number, x: number, y: number, z: number, inner: string): string {
  const [sx, sy] = P(x, y, z)
  return `<g transform="matrix(${a} ${b} ${c} ${d} ${f(sx)} ${f(sy)})">${inner}</g>`
}
/** Flat drawing (u right, v down) laid on a face toward +y, its top-left corner at (x, y, z). */
const onFront = (x: number, y: number, z: number, inner: string) => mat(1, 0.5, 0, 1, x, y, z, inner)
/** The same on a face toward +x: u runs along +y. */
const onSide = (x: number, y: number, z: number, inner: string) => mat(-1, 0.5, 0, 1, x, y, z, inner)
/**
 * Writing on a face toward +x that reads left to right: `onSide` runs u along
 * +y, which mirrors text, so this runs it along -y from (x, y, z), the left
 * end as you look at the wall.
 */
const onSideText = (x: number, y: number, z: number, inner: string) => mat(1, -0.5, 0, 1, x, y, z, inner)

const at = (x: number, y: number, inner: string) => `<g transform="translate(${f(x)} ${f(y)})">${inner}</g>`

const CSS = `
text{font-family:ui-monospace,'Cascadia Mono',Consolas,Menlo,monospace}
.enter{animation:enter .9s ease-out both}
@keyframes enter{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
.tl{animation:tap .26s steps(1) infinite}.tr{animation:tap .26s steps(1) infinite -.13s}
@keyframes tap{50%{transform:translateY(-1.5px)}}
.blink{animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.grow{transform-box:fill-box;transform-origin:0 50%;animation:grow 2.4s steps(7) infinite}
@keyframes grow{0%{transform:scaleX(0)}70%,100%{transform:scaleX(1)}}
.scroll{animation:scroll 2.4s steps(12) infinite}
@keyframes scroll{to{transform:translateY(-12px)}}
.scan{animation:scan 2.2s ease-in-out infinite alternate}
@keyframes scan{to{transform:translate(12px,3px)}}
.bx{animation:bx 3.3s linear infinite alternate}.by{animation:by 2.1s linear infinite alternate}
@keyframes bx{to{transform:translateX(19px)}}@keyframes by{to{transform:translateY(11px)}}
.bob{animation:bob 1.6s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-1.5px)}}
.nod{animation:nod 3.2s ease-in-out infinite}
@keyframes nod{50%{transform:translateY(1px)}}
.dot{animation:dot 1.2s steps(2) infinite}
@keyframes dot{0%,100%{opacity:.25}50%{opacity:1}}
.steam{animation:steam 2.2s ease-out infinite}
@keyframes steam{0%{opacity:0;transform:translateY(0)}30%{opacity:.7}100%{opacity:0;transform:translateY(-6px)}}
.eyes{transform-box:fill-box;transform-origin:center;animation:eyes 4s infinite}
@keyframes eyes{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.15)}}
.sway{transform-box:fill-box;transform-origin:50% 100%;animation:sway 3s ease-in-out infinite alternate}
@keyframes sway{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}
.cloud{animation:cloud 26s linear infinite}
@keyframes cloud{from{transform:translateX(-20px)}to{transform:translateX(50px)}}
.hand{transform-box:view-box;transform-origin:11px 11px}
@keyframes spin{to{transform:rotate(360deg)}}
.led{animation:dot .9s steps(2) infinite}
.wl1{animation:tap .5s steps(1) infinite}.wl2{animation:tap .5s steps(1) infinite -.25s}
.st:hover .tagbg{stroke-opacity:1;stroke-width:1.2}.st:hover .ring{stroke-width:2.2;opacity:1}
.ring{animation:ring 2.4s ease-in-out infinite}
@keyframes ring{50%{opacity:.25}}
.flow{animation:flow 1.1s linear infinite}
@keyframes flow{to{stroke-dashoffset:-14}}
.tw{animation:tw 2.6s ease-in-out infinite}
@keyframes tw{50%{opacity:.35}}
.neon{animation:neon 7s steps(1) infinite}
@keyframes neon{0%,100%{opacity:1}91%{opacity:.35}92%{opacity:1}94%{opacity:.5}95%{opacity:1}}
.mote{animation:mote 9s ease-in-out infinite}
@keyframes mote{0%,100%{transform:translate(0,0);opacity:0}20%,80%{opacity:.8}50%{transform:translate(6px,-9px)}}
.pop{animation:pop .35s ease-out both}
.needle{animation:needle 2.8s ease-in-out infinite alternate}
@keyframes needle{from{transform:rotate(-1.4deg)}to{transform:rotate(1.4deg)}}
.beacon{animation:spin 1.2s linear infinite}
.bub{opacity:0;animation:bub ${CHAT_SHOW_MS / 1000}s linear 1 forwards}
@keyframes bub{0%,96%{opacity:1}100%{opacity:0}}
.show{opacity:0;animation:show .01s linear 1 forwards}
@keyframes show{to{opacity:1}}
.hide{animation:hide .01s linear 1 forwards}
@keyframes hide{to{opacity:0}}
.say1{animation:say1 ${GREET_MS / 1000}s linear 1 both}
@keyframes say1{0%,97%{opacity:1}100%{opacity:0}}
@keyframes pop{from{opacity:0;transform:translateY(3px)}}
.say{opacity:0;animation:say 18s linear infinite}
@keyframes say{0%{opacity:0}2%,24%{opacity:1}26%,100%{opacity:0}}
.scrib{animation:scrib .45s steps(2) infinite}
@keyframes scrib{50%{transform:translate(2px,1.5px)}}
.sip{animation:sip 6s ease-in-out infinite}
@keyframes sip{0%,60%,100%{transform:none}70%,85%{transform:translateY(-4px)}}
.ink{stroke-dasharray:90;animation:ink 1.4s ease-out both}
@keyframes ink{from{stroke-dashoffset:90}to{stroke-dashoffset:0}}
.inkt{animation:inkt .5s ease-out both}
@keyframes inkt{from{opacity:0}}
.cf{transform-box:fill-box;transform-origin:center;animation:cf 1.9s cubic-bezier(.3,.6,.6,1) 3 both}
@keyframes cf{from{transform:translateY(-14px) rotate(0);opacity:1}to{transform:translateY(34px) rotate(540deg);opacity:0}}
`

// ---------------------------------------------------------------- furniture

const CHAIR = '#2d2f3d'
const METAL = '#1f2029'
const PANTS = '#363b52'

const DEFS =
  `<pattern id="planks" width="64" height="16" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .5 -1 .5 0 0)">` +
  r(0, 0, 64, 16, '#c79d6d') +
  r(0, 7.4, 64, 0.8, '#a98058') +
  r(0, 15.4, 64, 0.8, '#a98058') +
  r(0, 0, 0.8, 8, '#a98058') +
  r(32, 8, 0.8, 8, '#a98058') +
  r(10, 2, 14, 2, '#d1a978') +
  r(40, 10, 12, 2, '#bd9262') +
  `</pattern>` +
  `<radialGradient id="bg" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#2a3044"/><stop offset="1" stop-color="#151823"/></radialGradient>` +
  `<pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r=".6" fill="#ffffff" opacity=".07"/></pattern>` +
  `<radialGradient id="vig" cx=".5" cy=".48" r=".72"><stop offset=".55" stop-color="#05060a" stop-opacity="0"/><stop offset="1" stop-color="#05060a" stop-opacity=".55"/></radialGradient>` +
  // warm exposed brick for the upper walls, one for each wall's plane
  brick('brF', 'matrix(1 .5 0 1 0 0)', 0) +
  brick('brS', 'matrix(-1 .5 0 1 0 0)', -0.08) +
  `<pattern id="tiles" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .5 -1 .5 0 0)">${r(0, 0, 16, 16, '#666b78')}${r(0, 0, 16, 0.6, '#555a66')}${r(0, 0, 0.6, 16, '#555a66')}</pattern>` +
  idleRackDef() +
  `<filter id="glow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
  `<g id="desk">` +
  box(9, 7, 4, 40, 2, 11, '#6d4a2b') +
  box(6, 7, 0, 3, 18, 15, '#8a5d34') +
  box(49, 7, 0, 3, 18, 15, '#8a5d34') +
  box(6, 6, 15, 46, 20, 3, '#b98a57', { top: '#cfa06a' }) +
  box(23, 9, 18, 11, 6, 1, '#3a3f4b') +
  box(27, 10, 19, 3, 2, 4, '#3a3f4b') +
  box(14, 9, 22, 30, 3, 19, '#22263a', { top: '#2f3448' }) +
  box(20, 18, 18, 18, 5, 1.2, '#d9dce3') +
  box(39, 18, 18, 8, 7, 0.4, '#2b2d42') +
  box(41, 19, 18.4, 3, 4, 1.2, '#d9dce3') +
  // a pedestal of drawers, papers, a cable, sticky notes on the screen, a bin
  box(38, 9, 0, 10, 15, 14, '#8a5d34', { top: '#9c6b3f' }) +
  onFront(38, 24, 14, r(1, 1.5, 8, 3.6, '#7a5230') + r(1, 6, 8, 3.6, '#7a5230') + r(1, 10.5, 8, 3, '#7a5230') + r(4, 3, 2, 0.6, '#e9c46a') + r(4, 7.5, 2, 0.6, '#e9c46a')) +
  box(9, 17, 18, 8, 6, 1.6, '#f4f1e8') +
  box(9.5, 17.5, 19.6, 7, 5, 0.6, '#e8e2d0') +
  box(30, 10, 0, 1, 1, 22, '#111318') +
  onFront(14, 12, 41, r(0.8, 1, 3.2, 3.2, '#ffd166') + r(26, 2, 3.2, 3.2, '#ff8fab') + r(25, 14, 3, 3, '#a0e7e5')) +
  box(53, 20, 0, 5, 5, 7, '#4a4f5e', { top: '#2b2d42' }) +
  box(54, 21, 7, 3, 3, 1.2, '#f4f1e8') +
  `</g>` +
  `<g id="seat">` +
  box(29, 29, 0, 2, 16, 2, METAL) +
  box(22, 36, 0, 16, 2, 2, METAL) +
  box(29, 36, 2, 2, 2, 9, METAL) +
  box(22, 30, 11, 16, 13, 3, CHAIR) +
  `</g>` +
  `<g id="backW">${box(29, 42, 11, 2, 2, 4, METAL)}${box(22, 43, 14, 16, 3, 9, CHAIR, { top: '#45485c' })}</g>` +
  `<g id="backR">${box(22, 28, 14, 16, 3, 13, CHAIR, { top: '#45485c' })}</g>`

/**
 * The power gauge on the wall: a neon dial, green into amber into red, its
 * needle on how much of the usage window is spent, what is left in a readout,
 * when it refills underneath, and a beacon that wakes up near the limit.
 */
function usageMeter(u: Usage): string {
  const used = Math.max(0, Math.min(100, u.percent))
  const left = Math.round(100 - used)
  const isLow = used >= 90
  const color = isLow ? '#ef4444' : used >= 80 ? '#f59e0b' : '#22c55e'
  const cx = 17
  const cy = 18
  const R = 11.5
  const pt = (pct: number, rad = R): [number, number] => {
    const a = ((180 - 1.8 * pct) * Math.PI) / 180
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)]
  }
  const arc = (p0: number, p1: number, c: string, w: number, extra = '') => {
    const [x0, y0] = pt(p0)
    const [x1, y1] = pt(p1)
    return `<path d="M${f(x0)},${f(y0)} A${R},${R} 0 0 1 ${f(x1)},${f(y1)}" fill="none" stroke="${c}" stroke-width="${w}"${extra ? ' ' + extra : ''}/>`
  }
  let ticks = ''
  for (let k = 0; k <= 10; k++) {
    const [a1, b1] = pt(k * 10, R - 2.4)
    const [a2, b2] = pt(k * 10, R - (k % 5 ? 3.4 : 4.4))
    ticks += `<line x1="${f(a1)}" y1="${f(b1)}" x2="${f(a2)}" y2="${f(b2)}" stroke="#9aa3b5" stroke-width="${k % 5 ? 0.35 : 0.6}"/>`
  }
  const angle = -90 + 1.8 * used
  return (
    // the housing, a brass rim, a label
    r(-1, -1, 36, 33, '#141726', 'rx="3" stroke="#c9a227" stroke-width="1.2"') +
    `<text x="17" y="4.6" font-size="3" font-weight="700" fill="#c9a227" text-anchor="middle" letter-spacing=".4">⚡ POWER</text>` +
    // the dial: dim zones, then the spent part lit and glowing
    arc(0, 60, '#22c55e', 2.4, 'opacity=".25"') +
    arc(60, 80, '#f59e0b', 2.4, 'opacity=".25"') +
    arc(80, 100, '#ef4444', 2.4, 'opacity=".25"') +
    (used > 0.5 ? arc(0, used, color, 2.4, 'filter="url(#glow)"') : '') +
    ticks +
    // the needle, never quite still, and its cap
    `<g style="transform-box:view-box;transform-origin:${cx}px ${cy}px;transform:rotate(${angle.toFixed(1)}deg)"><g class="needle" style="transform-box:view-box;transform-origin:${cx}px ${cy}px">` +
    `<polygon points="${cx - 0.7},${cy} ${cx + 0.7},${cy} ${cx},${cy - R + 1.5}" fill="#f4f1de"/></g></g>` +
    `<circle cx="${cx}" cy="${cy}" r="1.8" fill="#c9a227" stroke="#2b2d42" stroke-width=".5"/>` +
    // the readout, and when it refills
    r(6, 21.5, 22, 5.5, '#0a0d14', `rx="1" stroke="${color}" stroke-opacity=".6" stroke-width=".4"`) +
    `<text x="17" y="25.6" font-size="3.6" font-weight="700" fill="${color}" text-anchor="middle"${isLow ? ' class="blink"' : ''}>${left}% LEFT</text>` +
    `<text x="17" y="30.4" font-size="2.6" fill="${isLow ? '#fca5a5' : '#9aa3b5'}" text-anchor="middle">${isLow ? '⚠ HOME SOON' : u.resetsAt ? `↻ refills ${esc(clockTime(u.resetsAt))}` : 'usage window'}</text>` +
    // near the limit, a beacon on top starts turning
    (isLow
      ? `<circle cx="31" cy="-2" r="2.6" fill="#7f1d1d"/><circle cx="31" cy="-2.6" r="2" fill="#ef4444" class="blink"/>` +
        `<g style="transform-box:view-box;transform-origin:31px -2.6px" class="beacon"><polygon points="31,-2.6 41,-6 41,0.8" fill="#ef4444" opacity=".35"/></g>`
      : '')
  )
}

/** A brick bond, laid on one wall's plane. */
function brick(id: string, transform: string, dim: number): string {
  const b = (c: string) => shade(c, dim)
  return (
    `<pattern id="${id}" width="16" height="8" patternUnits="userSpaceOnUse" patternTransform="${transform}">` +
    r(0, 0, 16, 8, b('#c4a088')) +
    r(0.5, 0.5, 7, 3, b('#a65a42')) +
    r(8.5, 0.5, 7, 3, b('#9b4f3a')) +
    r(-3.5, 4.5, 7, 3, b('#b0634a')) +
    r(4.5, 4.5, 7, 3, b('#a65a42')) +
    r(12.5, 4.5, 7, 3, b('#984b37')) +
    `</pattern>`
  )
}

/** Openings cut through a wall: [from, to] along it, [bottom, top] up it. */
type Opening = { a: number; b: number; z0: number; z1: number }

/**
 * A wall's room-side face with its windows cut out, so what is behind the
 * wall (the sky) shows through them: the back wall's on the
 * plane y = 0, the left wall's on x = 0.
 */
function wallFace(onBack: boolean, from: number, to: number, height: number, holes: Opening[], fill: string): string {
  const at3 = (u: number, z: number) => (onBack ? P(u, 0, z) : P(0, u, z))
  const loop = (pts: [number, number][]) => 'M' + pts.map(([a, b]) => f(a) + ',' + f(b)).join(' L') + ' Z'
  let d = loop([at3(from, 0), at3(to, 0), at3(to, height), at3(from, height)])
  for (const h of holes) d += ' ' + loop([at3(h.a, h.z0), at3(h.b, h.z0), at3(h.b, h.z1), at3(h.a, h.z1)])
  return `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`
}

/** Glass, mullions, a sill and, on the side wall, curtains, in an opening. */
function windowDressing(onBack: boolean, h: Opening, seed: number): string {
  const w = h.b - h.a
  const tall = h.z1 - h.z0
  const panes = Math.max(1, Math.round(w / 13))
  let s = r(0, 0, w, tall, '#d6ecf7', 'opacity=".08"')
  for (let i = 1; i < panes; i++) s += r((w * i) / panes - 0.4, 0, 0.8, tall, '#2b2420')
  s += r(0, tall / 3, w, 0.8, '#2b2420') + r(0, 0, w, tall, 'none', 'stroke="#2b2420" stroke-width="1.6"')
  s += r(-2, tall, w + 4, 2.2, '#8b5e3c')
  // pots on the sill
  const pots = ['#c0603a', '#e9c46a', '#f4f1de', '#2a9d8f']
  for (let i = 0; i < Math.min(3, Math.floor(w / 16)); i++) {
    const x = 4 + i * (w / 3)
    s += r(x, tall - 4, 4, 4, pots[(seed + i) % pots.length] ?? '#c0603a') + r(x + 0.5, tall - 8, 3, 4.5, ['#3a9d5d', '#4cb36f', '#2f8a50'][(seed + i) % 3] ?? '#3a9d5d', 'class="sway"')
  }
  if (!onBack) s += r(-6, -4, 5, tall + 6, '#c8553d', 'opacity=".9"') + r(w + 1, -4, 5, tall + 6, '#c8553d', 'opacity=".9"') + r(-7, -5.5, w + 14, 1.6, '#5e3d22')
  return onBack ? onFront(h.a, 0, h.z1, s) : onSide(0, h.a, h.z1, s)
}

function deskItem(item: DeskItem, ch: Character): string {
  switch (item) {
    case 'mug':
      return (
        box(9, 11, 18, 4, 4, 5, '#f1f1f1', { top: '#6b3e26' }) +
        box(13, 12, 19.5, 1, 2, 2.5, '#e2e2e2') +
        at(...P(11, 13, 24), `<g class="steam">${r(-1, -4, 0.8, 3, '#ffffffaa')}${r(1, -6, 0.8, 3, '#ffffffaa')}</g>`)
      )
    case 'plant':
      return (
        box(8, 9, 18, 6, 6, 5, '#c0603a') +
        `<g class="sway">${box(9.5, 10.5, 23, 3, 3, 8, '#3a9d5d')}${box(8, 12, 23, 2.5, 2.5, 5, '#4cb36f')}${box(12, 10, 23, 2.5, 2.5, 6, '#2f8a50')}</g>`
      )
    case 'duck':
      return (
        box(8, 11, 18, 6, 4, 3, '#ffd60a') +
        box(11.5, 11.5, 21, 3, 3, 3, '#ffd60a') +
        box(14.5, 12.3, 22, 1.6, 1.4, 0.9, '#f77f00')
      )
    case 'lamp':
      return (
        poly([[8, 12, 18.1], [17, 12, 18.1], [19, 22, 18.1], [6, 22, 18.1]], '#fff6b0', 'opacity=".28"') +
        box(8, 10, 18, 5, 5, 1, '#333') +
        box(10, 12, 19, 1, 1, 9, '#555') +
        box(8.5, 11, 28, 5, 4, 3, ch.accent)
      )
    case 'books':
      return box(7.5, 10, 18, 2, 5, 7, '#e63946') + box(9.5, 10, 18, 2, 5, 8.5, '#457b9d') + box(11.5, 10, 18, 2, 5, 6, '#f4a261')
    case 'cactus':
      return (
        box(9, 11, 18, 5, 5, 4, '#d9a066') +
        `<g class="sway">${box(10.5, 12.5, 22, 2, 2, 8, '#2d6a4f')}${box(12.5, 13, 25, 2, 1.5, 1.5, '#2d6a4f')}${box(13.5, 13, 25, 1, 1.5, 4, '#2d6a4f')}</g>`
      )
  }
}

// ---------------------------------------------------------------- screens

/** What a monitor shows, drawn in a 22x14 box. */
function screenBody(a: OfficeAgent | undefined, ch: Character): string {
  const s = seedOf(a?.id ?? 'empty')
  const widths = [0, 1, 2, 3, 4, 5].map(i => 6 + ((s >> (i * 3)) % 12))
  const wd = (i: number): number => widths[i % 6] ?? 8
  const CODE = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#ffcb6b']
  const code = (i: number): string => CODE[i % 6] ?? '#82aaff'
  switch (a?.status) {
    case undefined:
      return r(0, 0, 22, 14, '#0b0f17') + r(14, 1, 1.5, 6, '#ffffff12') + r(17, 1, 1, 4, '#ffffff12')
    case 'idle':
      return r(0, 0, 22, 14, '#0b1020') + `<g class="bx"><g class="by">${r(0, 0, 3, 3, ch.accent)}</g></g>`
    case 'thinking':
      return (
        r(0, 0, 22, 14, '#1b2333') +
        [0, 1, 2, 3].map(i => r(1 + (i % 2) * 2, 1 + i * 2, wd(i), 1, code(i) + '66')).join('') +
        r(2, 10, 2, 3, '#8ab4ff', 'class="blink"')
      )
    case 'typing':
      return (
        r(0, 0, 22, 14, '#1b2333') +
        [0, 1, 2, 3, 4, 5]
          .map(i => r(1 + (i % 3) * 2, 1 + i * 2, wd(i), 1, code(i), `class="grow" style="animation-delay:-${(i * 0.4).toFixed(1)}s"`))
          .join('')
      )
    case 'reading':
    case 'searching': {
      let lines = ''
      for (let i = 0; i < 14; i++) lines += r(2, 3 + i * 2, wd(i), 1, i % 6 === 0 ? '#555a66' : '#9aa0aa')
      let body = r(0, 0, 22, 14, '#f4f1e8') + `<g class="scroll">${lines}</g>` + r(0, 0, 22, 2, '#d7d2c4')
      if (a.status === 'searching') {
        body += `<g class="scan"><circle cx="5" cy="6" r="3" fill="#ffffff66" stroke="#2b2b3a" stroke-width="1"/>${r(7, 8, 3, 1, '#2b2b3a')}${r(9, 9, 2, 1, '#2b2b3a')}</g>`
      }
      return body
    }
    case 'running':
      return (
        r(0, 0, 22, 14, '#0c0c0c') +
        [0, 1, 2, 3]
          .map(i => r(1, 1 + i * 3, 2, 1, '#3ddc84') + r(4, 1 + i * 3, wd(i), 1, '#3ddc84', `class="grow" style="animation-delay:-${(i * 0.6).toFixed(1)}s"`))
          .join('') +
        r(1, 12, 2, 1, '#3ddc84', 'class="blink"')
      )
    case 'browsing': {
      let page = r(2, 4, 8, 6, ch.accent) + r(12, 4, 8, 1, '#9aa0aa') + r(12, 6, 6, 1, '#9aa0aa') + r(12, 8, 7, 1, '#9aa0aa')
      for (let i = 0; i < 6; i++) page += r(2, 12 + i * 2, wd(i), 1, '#c4c8d0')
      return (
        r(0, 0, 22, 14, '#ffffff') +
        `<g class="scroll">${page}</g>` +
        r(0, 0, 22, 3, '#e5e7eb') +
        r(1, 1, 1, 1, '#ef4444') +
        r(3, 1, 1, 1, '#f59e0b') +
        r(5, 1, 1, 1, '#22c55e') +
        r(7, 1, 13, 1, '#ffffff')
      )
    }
    case 'delegating':
      return (
        r(0, 0, 22, 14, '#1b2333') +
        r(9, 1, 4, 3, ch.accent) +
        r(10.5, 4, 1, 2, '#8892a6') +
        r(3, 6, 16, 1, '#8892a6') +
        r(3, 6, 1, 3, '#8892a6') +
        r(18, 6, 1, 3, '#8892a6') +
        r(10.5, 6, 1, 3, '#8892a6') +
        [1, 8.5, 16].map((x, i) => r(x, 9, 5, 3, '#f472b6', `class="dot" style="animation-delay:-${i * 0.4}s"`)).join('')
      )
    case 'working':
      return (
        r(0, 0, 22, 14, '#263238') +
        r(3, 3, 10, 1, '#90a4ae') +
        r(3, 5, 7, 1, '#607d8b') +
        r(3, 9, 16, 2, '#37474f') +
        r(3, 9, 16, 2, ch.accent, 'class="grow"')
      )
    case 'done':
      return (
        r(0, 0, 22, 14, '#0f2e1f') +
        `<polyline class="dot" points="6,7.5 9.5,10.5 16,3.5" fill="none" stroke="#52e08a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      )
  }
}

function monitor(a: OfficeAgent | undefined, ch: Character): string {
  const live = a !== undefined && a.status !== 'idle'
  const glow = live ? poly([[15, 12, 18.05], [43, 12, 18.05], [47, 24, 18.05], [11, 24, 18.05]], STATUS_COLOR[a.status], 'opacity=".14"') : ''
  return (
    glow +
    onFront(
      15.5,
      12,
      39.5,
      `<svg width="27" height="16" viewBox="0 0 22 14" preserveAspectRatio="none">${screenBody(a, ch)}</svg>` +
        r(25.5, 16.6, 1.2, 0.9, live ? '#3ddc84' : '#f4a261'),
    )
  )
}

// ---------------------------------------------------------------- light

type Light = {
  sky: [string, string]
  /** The sun or the moon in the window: cx, cy, r, color. */
  orb: [number, number, number, string]
  isNight: boolean
  /** Multiplied over the whole room. */
  tint?: [string, number]
  /** The window's light on the floor. */
  beam: [string, number]
  /** How strongly screens, lamps and bulbs light what is around them. */
  glow: number
}

const LIGHT: Record<Phase, Light> = {
  dawn: { sky: ['#f7a8b8', '#ffe3c2'], orb: [12, 22, 5, '#ffcf8a'], isNight: false, tint: ['#ffc9b0', 0.35], beam: ['#ffd9b8', 0.16], glow: 0.25 },
  day: { sky: ['#7cc0ea', '#c8e7f7'], orb: [10, 9, 4.5, '#ffd166'], isNight: false, beam: ['#fff7d6', 0.13], glow: 0.18 },
  dusk: { sky: ['#43306b', '#ff9466'], orb: [33, 21, 5.5, '#ff7b3d'], isNight: false, tint: ['#9a7ad0', 0.45], beam: ['#ffb37a', 0.18], glow: 0.45 },
  night: { sky: ['#070b1f', '#1c2754'], orb: [34, 8, 3.5, '#f4f1de'], isNight: true, tint: ['#1a2350', 0.55], beam: ['#a9bfff', 0.07], glow: 0.7 },
}

/** A soft pool of light in `color`, its gradient defined once per color. */
function pool(pools: Set<string>, color: string, cx: number, cy: number, rx: number, ry: number, opacity: number): string {
  pools.add(color)
  return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="url(#p${color.slice(1)})" opacity="${opacity.toFixed(2)}"/>`
}

const poolDefs = (pools: Set<string>): string =>
  [...pools]
    .map(c => `<radialGradient id="p${c.slice(1)}"><stop offset="0" stop-color="${c}" stop-opacity=".85"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`)
    .join('')


/** Fairy lights along the top of both walls, drawn over the tint so they always shine. */
function stringLights(X: number, Y: number, light: Light): string {
  const COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff']
  const SPAN = 26
  const strand = (len: number, k0: number) => {
    let wire = 'M2,0'
    let bulbs = ''
    let k = k0
    for (let u = 2; u + SPAN <= len; u += SPAN) {
      wire += ` Q${u + SPAN / 2},6 ${u + SPAN},0`
      for (const t of [0.5]) {
        const bx = u + SPAN * t
        const by = 6 * 2 * t * (1 - t) + 1.2
        const c = COLORS[k % COLORS.length] ?? '#ffd166'
        bulbs +=
          `<g class="tw" style="animation-delay:-${((k * 0.53) % 2.6).toFixed(2)}s">` +
          `<circle cx="${f(bx)}" cy="${f(by)}" r="${f(1.6 + light.glow * 2.4)}" fill="${c}" opacity="${(0.12 + light.glow * 0.4).toFixed(2)}"/>` +
          `<circle cx="${f(bx)}" cy="${f(by)}" r="1" fill="${c}"/></g>`
        k++
      }
    }
    return `<path d="${wire}" fill="none" stroke="#1d2030" stroke-width=".5"/>` + bulbs
  }
  return onFront(0, 0, 70.5, strand(X, 0)) + onSide(0, 0, 70.5, strand(Y, 2))
}

/** A neon sign on the back wall, over the tint. */
function neon(x: number, light: Light): string {
  const on = (0.7 + light.glow * 0.4).toFixed(2)
  return onFront(
    x,
    0,
    60,
    r(0, 0, 44, 20, '#141726', 'rx="2"') +
      `<g class="neon" opacity="${on}" filter="url(#glow)">` +
      `<rect x="1.5" y="1.5" width="41" height="17" rx="2" fill="none" stroke="#4cc9f0" stroke-width=".6"/>` +
      `<text x="22" y="9" font-size="6" font-weight="700" fill="#ff4fd8" text-anchor="middle">SHIP IT</text>` +
      `<text x="22" y="15.5" font-size="3.6" fill="#4cc9f0" text-anchor="middle">9BIT STUDIOS</text></g>`,
  )
}

/** The whiteboard: headcount, tool calls per minute, and what the calls were. */
function board(agents: OfficeAgent[], tasks: BgTask[], stats: OfficeStats): string {
  const busy = agents.filter(a => a.status !== 'idle' && a.status !== 'done').length
  const W = 84
  let s =
    r(0, 0, W, 38, '#cfd4de') +
    r(1.5, 1.5, W - 3, 35, '#fbfbf8') +
    `<text x="5" y="9.5" font-size="6" font-weight="700" fill="#2b2d42">AGENT OFFICE</text>` +
    `<text x="5" y="16.5" font-size="4" fill="#3d5a80">staff ${agents.length} · busy ${busy}</text>` +
    `<text x="5" y="22.5" font-size="4" fill="#2a9d8f">tools ${stats.tools} · tasks ${tasks.length}</text>` +
    `<text x="5" y="28.5" font-size="4" fill="#e76f51">shipped ${stats.done}</text>`
  // tool calls per minute, the last 16 whole minutes
  const hist = (stats.history ?? []).slice(-16)
  const max = Math.max(1, ...hist)
  s += `<text x="61" y="8" font-size="3.2" fill="#6b7280">tools/min</text>` + r(60, 29.6, 21, 0.5, '#9aa3b5')
  hist.forEach((n, i) => {
    const h = n ? 1 + (19 * n) / max : 0.4
    s += r(60.5 + (16 - hist.length + i) * 1.25, 29.6 - h, 0.9, h, i === hist.length - 1 ? '#e76f51' : '#3d5a80')
  })
  // what the calls were, as one stacked bar
  const kinds = Object.entries(stats.kinds ?? {}).filter(([k, n]) => (n ?? 0) > 0 && KIND_LABEL[k as keyof typeof KIND_LABEL])
  const total = kinds.reduce((t, [, n]) => t + (n ?? 0), 0)
  let x = 5
  if (!total) s += r(5, 31.5, W - 10, 1.8, '#e5e7eb')
  for (const [k, n] of kinds) {
    const w = ((W - 10) * (n ?? 0)) / total
    s += r(x, 31.5, w, 1.8, STATUS_COLOR[k as keyof typeof STATUS_COLOR])
    x += w
  }
  return s + r(20, 38, 44, 1.6, '#9aa3b5')
}

// ---------------------------------------------------------------- people

/** The head at (25, 31, 26), 10 x 9 x 10, its hair, and what sits on it. */
function head(ch: Character, facing: 'away' | 'toward'): { before: string; head: string; after: string } {
  const { hair, skin, accent, style } = ch
  const sideSkin = shade(skin, -0.15)
  let before = ''
  let after = ''
  let frontDetail = ''
  let sideDetail = ''
  if (facing === 'toward') {
    frontDetail =
      r(0, 0, 10, 2.6, hair) +
      (style === 'long' ? r(0, 0, 1.3, 10, hair) + r(8.7, 0, 1.3, 10, hair) : '') +
      `<g class="eyes">${r(2.2, 4.3, 1.6, 2, '#1d1d1d')}${r(6.2, 4.3, 1.6, 2, '#1d1d1d')}</g>`
    sideDetail = (style === 'long' ? '' : r(5, 2.6, 4, 7.4, sideSkin)) + r(3.8, 4.5, 1.5, 2.2, shade(skin, -0.25))
  } else {
    frontDetail = style === 'long' ? '' : r(2, 8.6, 6, 1.4, skin)
    sideDetail = (style === 'long' ? r(0, 3, 2.5, 5, sideSkin) : r(0, 2.6, 4, 7.4, sideSkin)) + r(3.8, 4.5, 1.5, 2.2, shade(skin, -0.25))
  }
  const base =
    box(25, 31, 26, 10, 9, 10, hair, { top: shade(hair, 0.08), front: facing === 'toward' ? skin : hair, side: shade(hair, -0.15) }) +
    onFront(25, 40, 36, frontDetail) +
    onSide(35, 31, 36, sideDetail)
  switch (style) {
    case 'bun':
      after += box(28, 34, 36, 4, 4, 4, hair) + box(28.5, 34.5, 36, 3, 3, 0.8, accent)
      break
    case 'spiky':
      for (const [x, y, h] of [[25.5, 32, 3], [29, 32.5, 4.5], [33, 33, 3.5], [27, 36, 4], [31, 37, 3], [33.5, 37.5, 2.5]] as const) {
        after += box(x, y, 36, 2, 2, h, hair)
      }
      break
    case 'cap':
      after += box(24.6, 30.6, 34.5, 10.8, 9.8, 2.6, accent) + box(26, 39.8, 34.5, 8, 3.5, 0.9, shade(accent, -0.18))
      break
    case 'headset':
      before += box(23.6, 33.5, 29, 1.5, 4, 5, '#333')
      after +=
        box(24.6, 34.5, 36, 10.8, 1.5, 0.9, '#222') +
        box(35, 33.5, 29, 1.5, 4, 5, '#333') +
        onSide(36.5, 33.5, 33, r(1.5, 1.5, 1, 1, accent, 'class="blink"'))
      break
    case 'long':
      if (facing === 'away') after += box(25, 39.6, 17, 10, 1.8, 13, hair)
      else before += box(25, 29.4, 18, 10, 1.8, 14, hair)
      break
    case 'short':
      break
  }
  return { before, head: base, after }
}

/** Back to the viewer, facing the monitor. */
function working(a: OfficeAgent, ch: Character): string {
  const { skin, shirt } = ch
  const sleeve = shade(shirt, -0.06)
  const typing = a.status === 'typing' || a.status === 'running'
  const h = head(ch, 'away')
  const nod = a.status === 'thinking' || a.status === 'reading' || a.status === 'searching'
  return (
    `<use href="#seat"/>` +
    box(21.5, 22, 19, 3, 12, 4, sleeve) +
    `<g${typing ? ' class="tl"' : ''}>${box(21.5, 19, 18.4, 3, 3, 2.4, skin)}</g>` +
    box(35.5, 22, 19, 3, 12, 4, sleeve) +
    `<g${typing ? ' class="tr"' : ''}>${box(35.5, 19, 18.4, 3, 3, 2.4, skin)}</g>` +
    box(24, 32, 14, 12, 7, 12, shirt) +
    `<g${nod ? ' class="nod"' : ''}>${h.before}${h.head}${h.after}</g>` +
    `<use href="#backW"/>`
  )
}

/** Turned around in the chair: a coffee when idle, a thumbs-up when done. */
function resting(a: OfficeAgent, ch: Character): string {
  const { skin, shirt } = ch
  const sleeve = shade(shirt, -0.06)
  const h = head(ch, 'toward')
  const isDone = a.status === 'done'
  const mouth = isDone
    ? r(3.4, 7.2, 3.2, 0.9, '#7a2e2e') + r(2.8, 6.6, 0.8, 0.8, '#7a2e2e') + r(6.4, 6.6, 0.8, 0.8, '#7a2e2e') + r(1, 6.3, 1.3, 0.8, '#f4978e') + r(7.7, 6.3, 1.3, 0.8, '#f4978e')
    : r(4, 7.4, 2, 0.8, '#7a2e2e')
  const rightArm = isDone
    ? box(36, 34, 21, 3, 3, 11, sleeve) + box(36, 34, 32, 3, 3, 3, skin) + box(36.8, 34.5, 35, 1.3, 1.3, 2.2, skin)
    : box(36, 33, 17, 3, 5, 5, sleeve) +
      box(36, 38, 18, 3, 4, 3, skin) +
      box(35.5, 41.5, 19, 4, 4, 5, '#f1f1f1', { top: '#6b3e26' }) +
      box(39.5, 42.5, 20, 1, 2, 3, '#e2e2e2') +
      at(...P(37.5, 43.5, 25), `<g class="steam">${r(-1, -4, 0.8, 3, '#ffffffaa')}${r(1, -6, 0.8, 3, '#ffffffaa')}</g>`)
  return (
    `<use href="#backR"/><use href="#seat"/>` +
    h.before +
    box(21, 33, 15.5, 3, 5, 10, sleeve) +
    box(24, 31, 14, 12, 7, 12, shirt) +
    onFront(24, 38, 26, r(5, 0, 2, 1.6, skin)) +
    h.head +
    onFront(25, 40, 36, mouth) +
    h.after +
    box(25, 38, 13, 4.5, 9, 4, PANTS) +
    box(30.5, 38, 13, 4.5, 9, 4, PANTS) +
    box(25, 44, 2, 4.5, 3, 11, PANTS) +
    box(30.5, 44, 2, 4.5, 3, 11, PANTS) +
    box(25, 44, 0, 4.5, 5.5, 2.2, '#2a2a2a') +
    box(30.5, 44, 0, 4.5, 5.5, 2.2, '#2a2a2a') +
    rightArm
  )
}

// ---------------------------------------------------------------- labels

function tag(title: string, titleColor: string, sub: string, line: string, dot: string | undefined, isLive: boolean, star: boolean, level: number): { svg: string; w: number } {
  const lv = `Lv${level}`
  const w = Math.max((title.length + (star ? 2 : 0)) * 3.5 + (lv.length + 1) * 2.4 + sub.length * 2.75 + 6, line.length * 2.85) + 12
  const x0 = -w / 2
  return {
    w,
    svg:
      `<rect class="tagbg" x="${f(x0)}" y="-15" width="${f(w)}" height="15.5" rx="3" fill="#121521" fill-opacity=".92" stroke="${titleColor}" stroke-opacity=".55" stroke-width=".7"/>` +
      `<rect x="${f(x0)}" y="-15" width="2.2" height="15.5" rx="1.1" fill="${titleColor}" opacity=".85"/>` +
      `<polygon points="-2.5,0.5 2.5,0.5 0,3.5" fill="#121521" fill-opacity=".92"/>` +
      `<text x="${f(x0 + 5)}" y="-8.3" font-size="5.6" font-weight="700" fill="${titleColor}">${star ? '<tspan fill="#fbbf24">★ </tspan>' : ''}${esc(title)}<tspan font-size="3.8" fill="#fbbf24"> ${lv}</tspan><tspan font-size="4.4" font-weight="400" fill="#9aa3b5"> · ${esc(sub)}</tspan></text>` +
      `<text x="${f(x0 + 5)}" y="-2.6" font-size="4.6" fill="#d5dae4">${esc(line)}</text>` +
      (dot ? `<circle cx="${f(-x0 - 5)}" cy="-10.6" r="1.7" fill="${dot}"${isLive ? ' class="dot"' : ''}/>` : ''),
  }
}

/** One line, for the racks. */
function miniTag(text: string, color: string, age: string): string {
  const w = (text.length + age.length + 3) * 2.8 + 8
  const x0 = -w / 2
  return (
    `<rect x="${f(x0)}" y="-9" width="${f(w)}" height="9" rx="2.5" fill="#121521" fill-opacity=".9" stroke="${color}" stroke-opacity=".45" stroke-width=".6"/>` +
    `<text x="${f(x0 + 4)}" y="-3" font-size="4.6" fill="#d5dae4">${esc(text)}<tspan fill="#3ddc84"> · ${esc(age)}</tspan></text>`
  )
}

function bubble(a: OfficeAgent): string {
  switch (a.status) {
    case 'thinking':
      return `<g class="bob">${r(2, 0, 14, 7, '#fff')}${r(1, 1, 16, 5, '#fff')}${[4, 8, 12]
        .map((x, i) => r(x, 2.5, 2, 2, '#555', `class="dot" style="animation-delay:-${(i * 0.3).toFixed(1)}s"`))
        .join('')}${r(0, 8, 2, 2, '#fff')}${r(-2, 10.5, 1.2, 1.2, '#fff')}</g>`
    case 'delegating':
      return `<g class="bob">${r(1, 0, 16, 8, '#ffe66d')}${r(0, 1, 18, 6, '#ffe66d')}${r(2, 8, 2, 2, '#ffe66d')}${r(4, 3, 6, 2, '#333')}<polygon points="10,1 14,4 10,7" fill="#333"/></g>`
    case 'done':
      return `<g class="bob">${r(1, 0, 15, 9, '#52b788')}${r(0, 1, 17, 7, '#52b788')}<polyline points="4,4.5 7,7 13,1.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></g>`
    default:
      return ''
  }
}

// ---------------------------------------------------------------- stations

/** A burst of confetti over a desk whose agent just finished. */
function confetti(seed: number): string {
  const COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#f472b6']
  let s = ''
  for (let i = 0; i < 16; i++) {
    const x = ((seed >>> i) % 44) - 22
    const y = -((seed >>> (i + 3)) % 12)
    s += r(x, y, 1.6, 1, COLORS[i % COLORS.length] ?? '#ffd166', `class="cf" style="animation-delay:${((i % 5) * 0.12).toFixed(2)}s"`)
  }
  return s
}

const CONFETTI_MS = 8000

function station(a: OfficeAgent | undefined, now: number, isAway = false): { body: string; overlay: string } {
  const ch = a ? character(a.character) : character(1)
  const [sx, sy] = P(30, 37, 0)
  const live = a !== undefined && !isAway && a.status !== 'idle' && a.status !== 'done'
  const ring = a && !isAway
    ? `<ellipse class="ring${live ? '' : ' still'}" cx="${f(sx)}" cy="${f(sy)}" rx="25" ry="12.5" fill="none" stroke="${live ? STATUS_COLOR[a.status] : '#64748b'}" stroke-width="1.1" opacity="${live ? '.8' : '.35'}"${live ? '' : ' style="animation:none"'}/>`
    : ''
  let body =
    ring + `<ellipse cx="${f(sx)}" cy="${f(sy)}" rx="17" ry="8.5" fill="#000" opacity=".16"/>` + `<use href="#desk"/>` + monitor(a, ch)
  let overlay = ''
  if (!a) {
    body += `<use href="#seat"/><use href="#backW"/>`
    return { body, overlay }
  }
  body += deskItem(ch.item, ch)
  const [hx, hy] = P(30, 36, 48)
  const party = a.status === 'done' && now - a.updatedAt < CONFETTI_MS ? at(hx, hy - 8, confetti(seedOf(a.id))) : ''
  if (isAway) {
    // out for a walk: the chair waits, the walker carries the name tag
    return { body: body + `<use href="#seat"/><use href="#backW"/>`, overlay: party }
  }
  body += a.status === 'idle' || a.status === 'done' ? resting(a, ch) : working(a, ch)
  const t = tag(ch.name, ch.accent, subtitle(a), clip(activityLine(a), 26), STATUS_COLOR[a.status], live, a.id === 'main', levelOf(a.tools))
  overlay = at(hx, hy, t.svg) + at(hx + t.w / 2 + 2, hy - 20, bubble(a)) + party
  const title = `<title>${esc(`${ch.name} (${subtitle(a)}) · level ${levelOf(a.tools)}${a.task ? `\nTask: ${a.task}` : ''}\nNow: ${activityLine(a)}\nTool calls: ${a.tools}\nAt the desk: ${fmtAge(now - a.joinedAt)}`)}</title>`
  const enter = now - a.joinedAt < 2500 ? ' enter' : ''
  return { body: `<g class="st${enter}">${title}${body}</g>`, overlay: `<g class="st${enter}">${overlay}</g>` }
}

/** A background task: a server rack humming in the corner. */
function rack(t: BgTask, now: number, k: number, crew: number): { body: string; overlay: string } {
  const ch = character(t.character)
  const isFlow = t.kind === 'workflow'
  let units = ''
  for (let i = 0; i < 4; i++) {
    units +=
      r(1, 2 + i * 8, 10, 6.5, '#161922') +
      r(2.2, 4 + i * 8, 1.4, 1.4, '#3ddc84', `class="led" style="animation-delay:-${((k * 3 + i) * 0.23).toFixed(2)}s"`) +
      r(4.6, 4 + i * 8, 1.4, 1.4, isFlow ? '#c084fc' : i % 2 ? '#f4a261' : '#60a5fa', `class="led" style="animation-delay:-${((k + i) * 0.37).toFixed(2)}s"`) +
      r(7, 4.3 + i * 8, 3, 0.8, '#3a3f52')
  }
  const body =
    `<ellipse cx="${f(P(6, 5, 0)[0])}" cy="${f(P(6, 5, 0)[1])}" rx="11" ry="5.5" fill="#000" opacity=".18"/>` +
    box(0, 0, 0, 12, 10, 36, isFlow ? '#30293f' : '#2b2f3a', { top: isFlow ? '#c084fc' : '#3a3f4e' }) +
    onFront(0, 10, 36, units) +
    onSide(12, 0, 36, r(1, 2, 8, 32, '#00000022'))
  const [hx, hy] = P(6, 5, 40)
  const text = isFlow ? `▶ ${clip(t.label, 22)}${crew ? ` · ${crew} agents` : ''}` : `⚙ ${clip(t.label, 26)}`
  return { body, overlay: at(hx, hy, miniTag(text, isFlow ? '#c084fc' : ch.accent, fmtAge(now - t.startedAt))) }
}

// ---------------------------------------------------------------- walkers

type Dir = 'px' | 'nx' | 'py' | 'ny'

/** The head of a standing figure, 10 x 10 x 10 at (-5, -5, 26), its face turned toward `dir`. */
function walkerHead(ch: Character, dir: Dir): string {
  const { hair, skin, accent, style } = ch
  const isLong = style === 'long'
  const face =
    r(0, 0, 10, 2.6, hair) +
    (isLong ? r(0, 0, 1.3, 10, hair) + r(8.7, 0, 1.3, 10, hair) : '') +
    `<g class="eyes">${r(2.2, 4.3, 1.6, 2, '#1d1d1d')}${r(6.2, 4.3, 1.6, 2, '#1d1d1d')}</g>` +
    r(4, 7.4, 2, 0.8, '#7a2e2e')
  const back = isLong ? '' : r(2, 8.6, 6, 1.4, skin)
  // a side view: skin toward the end the face is at, hair behind
  const profile = (faceAtEnd: boolean) =>
    (isLong ? r(faceAtEnd ? 7.5 : 0, 3, 2.5, 5, skin) : r(faceAtEnd ? 5 : 0, 2.6, 5, 7.4, skin)) +
    r(4.2, 4.5, 1.5, 2.2, shade(skin, -0.1))
  const frontArt = dir === 'py' ? face : dir === 'ny' ? back : profile(dir === 'px')
  const sideArt = dir === 'px' ? face : dir === 'nx' ? back : profile(dir === 'py')
  const alongX = dir === 'px' || dir === 'nx'
  let before = ''
  let after = ''
  switch (style) {
    case 'bun':
      after += box(-2, -2, 36, 4, 4, 4, hair) + box(-1.5, -1.5, 36, 3, 3, 0.8, accent)
      break
    case 'spiky':
      for (const [x, y, h] of [[-4, -3, 3], [-1, -4, 4.5], [2, -2, 3.5], [-3, 1, 4], [0.5, 2, 3]] as const) after += box(x, y, 36, 2, 2, h, hair)
      break
    case 'cap': {
      after += box(-5.4, -5.4, 34.5, 10.8, 10.8, 2.6, accent)
      const brim = shade(accent, -0.18)
      if (dir === 'px') after += box(5, -4, 34.5, 3.5, 8, 0.9, brim)
      if (dir === 'py') after += box(-4, 5, 34.5, 8, 3.5, 0.9, brim)
      if (dir === 'nx') before += box(-8.5, -4, 34.5, 3.5, 8, 0.9, brim)
      if (dir === 'ny') before += box(-4, -8.5, 34.5, 8, 3.5, 0.9, brim)
      break
    }
    case 'headset':
      if (alongX) {
        before += box(-2, -6.6, 29, 4, 1.6, 5, '#333')
        after += box(-0.75, -5.4, 36, 1.5, 10.8, 0.9, '#222') + box(-2, 5, 29, 4, 1.6, 5, '#333')
      } else {
        before += box(-6.6, -2, 29, 1.6, 4, 5, '#333')
        after += box(-5.4, -0.75, 36, 10.8, 1.5, 0.9, '#222') + box(5, -2, 29, 1.6, 4, 5, '#333')
      }
      break
    case 'long':
      if (dir === 'px') before += box(-6.6, -5, 22, 1.6, 10, 12, hair)
      if (dir === 'py') before += box(-5, -6.6, 22, 10, 1.6, 12, hair)
      if (dir === 'nx') after += box(5, -5, 22, 1.6, 10, 12, hair)
      if (dir === 'ny') after += box(-5, 5, 22, 10, 1.6, 12, hair)
      break
    case 'short':
      break
  }
  return (
    before +
    box(-5, -5, 26, 10, 10, 10, hair, { top: shade(hair, 0.08), front: dir === 'py' ? skin : hair, side: dir === 'px' ? skin : hair }) +
    onFront(-5, 5, 36, frontArt) +
    onSide(5, -5, 36, sideArt + r(0, 0, 10, 10, '#000', 'opacity=".14"')) +
    after
  )
}

/** You, when you come in through the door. */
const YOU: Character = { name: 'You', skin: '#e0ac69', hair: '#2b1a10', style: 'short', shirt: '#264653', accent: '#e9c46a', item: 'mug' }
const castOf = (i: number): Character => (i < 0 ? YOU : character(i))

type SpritePose = 'walk' | 'stand' | 'draw' | 'sip'

/** A standing figure, feet at the origin, facing `dir`: mid-stride, still, at the whiteboard or with a drink. */
function walkerSprite(ch: Character, dir: Dir, pose: SpritePose = 'walk'): string {
  const alongX = dir === 'px' || dir === 'nx'
  // a runs along the facing axis, s across it
  const B = (a: number, sd: number, z: number, la: number, ls: number, h: number, color: string, faces: Faces = {}) =>
    alongX ? box(a, sd, z, la, ls, h, color, faces) : box(sd, a, z, ls, la, h, color, faces)
  // the same, `a` counted toward the way the figure faces
  const ahead = dir === 'px' || dir === 'py' ? 1 : -1
  const F = (a: number, sd: number, z: number, la: number, ls: number, h: number, color: string, faces: Faces = {}) =>
    B(ahead > 0 ? a : -(a + la), sd, z, la, ls, h, color, faces)
  const sleeve = shade(ch.shirt, -0.06)
  const step = (c: string) => (pose === 'walk' ? ` class="${c}"` : '')
  let arm = `<g${step('wl1')}>${B(-1.5, 6, 14, 3, 3, 11, sleeve)}</g>`
  let behind = ''
  if (pose === 'draw') {
    arm = `<g class="scrib">${B(-1.5, 6, 25, 3, 3, 10, sleeve)}${B(-1.5, 6, 35, 3, 3, 2.5, ch.skin)}</g>`
  } else if (pose === 'sip') {
    const mug =
      `<g class="sip">${F(1.5, 3.5, 23, 5, 3, 3, sleeve)}` +
      F(5.5, -1.5, 24, 3.5, 3.5, 4.5, '#f1f1f1', { top: '#6b3e26' }) +
      `</g>`
    arm = B(-1.5, 6, 17, 3, 3, 8, sleeve) + (ahead > 0 ? mug : '')
    if (ahead < 0) behind = mug
  }
  return (
    `<ellipse cx="0" cy="0" rx="9" ry="4.5" fill="#000" opacity=".2"/>` +
    behind +
    `<g${step('wl2')}>${B(-1.5, -9, 14, 3, 3, 11, sleeve)}</g>` +
    `<g${step('wl1')}>${B(-2.25, -5, 0, 4.5, 4.5, 13, PANTS)}</g>` +
    `<g${step('wl2')}>${B(-2.25, 0.5, 0, 4.5, 4.5, 13, PANTS)}</g>` +
    B(-3.5, -6, 13, 7, 12, 13, ch.shirt) +
    walkerHead(ch, dir) +
    arm
  )
}

/** Sitting on the couch, facing the room (+x), a mug in hand. */
function sitSprite(ch: Character): string {
  const sleeve = shade(ch.shirt, -0.06)
  return (
    box(-1.5, -9, 11, 3, 3, 10, sleeve) +
    box(-2, -5, 7, 10, 4.5, 3, PANTS) +
    box(-2, 0.5, 7, 10, 4.5, 3, PANTS) +
    box(6, -5, 1.5, 3, 4.5, 6, PANTS) +
    box(6, 0.5, 1.5, 3, 4.5, 6, PANTS) +
    box(6, -5, 0, 5, 4.5, 1.8, '#2a2a2a') +
    box(6, 0.5, 0, 5, 4.5, 1.8, '#2a2a2a') +
    `<g transform="translate(0 3)">${box(-3.5, -6, 13, 7, 12, 13, ch.shirt)}${walkerHead(ch, 'px')}</g>` +
    `<g class="sip">${box(-1.5, 6, 13, 7, 3, 3, sleeve)}${box(5.5, 5, 13, 3.5, 3.5, 4.5, '#f1f1f1', { top: '#6b3e26' })}` +
    at(...P(7.2, 6.7, 18), `<g class="steam">${r(-1, -4, 0.8, 3, '#ffffffaa')}${r(1, -6, 0.8, 3, '#ffffffaa')}</g>`) +
    `</g>`
  )
}

/** Each figure's look is drawn once, in the defs, and placed by reference. */
function spriteRef(defs: Map<string, string>, charIndex: number, dir: Dir, pose: SpritePose | 'sit'): string {
  const id = `f${charIndex < 0 ? 'u' : charIndex}${pose === 'sit' ? 'sit' : dir + pose}`
  if (!defs.has(id)) {
    const ch = castOf(charIndex)
    defs.set(id, `<g id="${id}">${pose === 'sit' ? sitSprite(ch) : walkerSprite(ch, dir, pose)}</g>`)
  }
  return `<use href="#${id}"/>`
}

type Painted = { layers: Map<string, string>; labels: string; css: string }

/**
 * One figure on the stage, painted into the layers its walk passes through:
 * one copy per layer and look, each shown only on its own legs, all moved
 * along one route. A walk long over is drawn standing still where it ended.
 */
function paintActor(act: Actor, now: number, uid: string, defs: Map<string, string>, into: Painted) {
  const legs = act.legs
  const T = legs[legs.length - 1]?.to ?? 0
  if (!legs.length || T <= 0) return
  const elapsed = (now - act.start) / 1000
  const ch = castOf(act.character)
  const looks = (l: StageLeg) => (l.pose === 'sit' ? 'sit' : l.pose)
  const add = (layer: string, s: string) => into.layers.set(layer, (into.layers.get(layer) ?? '') + s)
  const isStill = !act.isLoop && elapsed >= T
  // names over you, the lead and anyone walking; the crew listening at the board stand unnamed
  const isNamed = act.id === 'you' || act.id === 'main' || act.legs.some(l => l.pose === 'walk' && l.to > (now - act.start) / 1000)
  const label = (inner: string) =>
    (isNamed ? at(0, -44, miniTag(ch.name, ch.accent, act.id === 'you' ? 'just arrived' : act.id === 'main' ? 'lead' : 'on the move')) : '') + inner
  const speech_ = (text: string, toCharacter?: number) =>
    at(0, -54, speech(text, ch.accent, toCharacter === undefined ? undefined : castOf(toCharacter).name))

  if (isStill || legs.length === 1) {
    const last = legs[legs.length - 1] as StageLeg
    const [x, y] = P(last.b[0], last.b[1], 0)
    const t = act.isLoop ? 0 : Math.min(elapsed, T)
    const talk = act.says.filter(s => t >= s.from && t < s.to).map(s => speech_(s.text, s.toCharacter)).join('')
    add(last.layer, at(x, y, spriteRef(defs, act.character, last.dir, looks(last))))
    into.labels += at(x, y, `<g class="enter">${label(talk)}</g>`)
    return
  }

  const pct = (t: number) => ((t / T) * 100).toFixed(3) + '%'
  const run = (name: string, timing: string) =>
    act.isLoop
      ? `animation:${name} ${T.toFixed(2)}s ${timing} infinite -${(elapsed % T).toFixed(2)}s`
      : `animation:${name} ${T.toFixed(2)}s ${timing} 1 -${elapsed.toFixed(2)}s both`
  let route = ''
  for (const l of legs) {
    const [ax, ay] = P(l.a[0], l.a[1], 0)
    const [bx, by] = P(l.b[0], l.b[1], 0)
    route += `${pct(l.from)}{transform:translate(${f(ax)}px,${f(ay)}px)}${pct(l.to)}{transform:translate(${f(bx)}px,${f(by)}px)}`
  }
  into.css += `@keyframes r${uid}{${route}}`
  const now0 = act.isLoop ? elapsed % T : Math.min(elapsed, T)
  const cur = legs.find(l => now0 >= l.from && now0 < l.to) ?? (legs[legs.length - 1] as StageLeg)
  const [px0, py0] = P(cur.a[0] + (cur.b[0] - cur.a[0]) * ((now0 - cur.from) / Math.max(0.001, cur.to - cur.from)), cur.a[1] + (cur.b[1] - cur.a[1]) * ((now0 - cur.from) / Math.max(0.001, cur.to - cur.from)), 0)
  const mover = (inner: string) => `<g style="transform:translate(${f(px0)}px,${f(py0)}px);${run(`r${uid}`, 'linear')}">${inner}</g>`

  // one copy per layer and look, visible on its own legs only
  const groups = new Map<string, StageLeg[]>()
  for (const l of legs) {
    const k = `${l.layer}|${l.dir}|${looks(l)}`
    groups.set(k, [...(groups.get(k) ?? []), l])
  }
  let n = 0
  for (const [k, own] of groups) {
    const [layer, dir, look] = k.split('|') as [string, Dir, SpritePose | 'sit']
    const frames = own.map(l => `${pct(l.from)}{opacity:1}${pct(l.to)}{opacity:0}`).join('')
    const name = `v${uid}_${n++}`
    const endsOn = own.some(l => l.to >= T) && act.seatedAt === undefined
    into.css += `@keyframes ${name}{0%{opacity:0}${frames}${endsOn ? '100%{opacity:1}' : ''}}`
    const on = own.some(l => l === cur) ? 1 : 0
    add(layer, mover(`<g style="opacity:${on};${run(name, 'step-end')}">${spriteRef(defs, act.character, dir, look)}</g>`))
  }
  // name and what is said, riding along
  let talk = ''
  act.says.forEach((s, i) => {
    const name = `s${uid}_${i}`
    into.css += `@keyframes ${name}{0%{opacity:0}${pct(s.from)}{opacity:0}${pct(Math.min(T, s.from + 0.01))}{opacity:1}${pct(Math.min(T, s.to))}{opacity:1}${pct(Math.min(T, s.to + 0.01))}{opacity:0}100%{opacity:${s.to >= T ? 1 : 0}}}`
    const on = now0 >= s.from && now0 < s.to ? 1 : 0
    talk += `<g style="opacity:${on};${run(name, 'step-end')}">${speech_(s.text, s.toCharacter)}</g>`
  })
  const gone = act.seatedAt !== undefined ? ` class="hide" style="animation-delay:${(act.seatedAt - elapsed).toFixed(2)}s"` : ''
  into.labels += `<g${gone}>${mover(label(talk))}</g>`
}

type Leg = { dir: Dir; from: number; to: number; isFront: boolean }
type WalkPlan = { period: number; stops: { t: number; at: [number, number] }[]; legs: Leg[] }

const WALK_SPEED = 10
const COOLER_PAUSE = 3

/**
 * The loop every walker takes: a pause at the water cooler, then along the
 * back aisle, down the right aisle, back along the front and up the left.
 * The back and left legs pass behind the desks, the right and front legs in
 * front of them, which is the layer each is drawn in.
 */
function walkPlan(right: number, front: number): WalkPlan {
  const A: [number, number] = [18, 20]
  const B: [number, number] = [right, 20]
  const C: [number, number] = [right, front]
  const D: [number, number] = [18, front]
  const t1 = COOLER_PAUSE
  const t2 = t1 + (B[0] - A[0]) / WALK_SPEED
  const t3 = t2 + (C[1] - B[1]) / WALK_SPEED
  const t4 = t3 + (C[0] - D[0]) / WALK_SPEED
  const period = t4 + (D[1] - A[1]) / WALK_SPEED
  return {
    period,
    stops: [
      { t: 0, at: A },
      { t: t1, at: A },
      { t: t2, at: B },
      { t: t3, at: C },
      { t: t4, at: D },
      { t: period, at: A },
    ],
    legs: [
      { dir: 'ny', from: 0, to: t1, isFront: false },
      { dir: 'px', from: t1, to: t2, isFront: false },
      { dir: 'py', from: t2, to: t3, isFront: true },
      { dir: 'nx', from: t3, to: t4, isFront: true },
      { dir: 'ny', from: t4, to: period, isFront: false },
    ],
  }
}

function placeAt(plan: WalkPlan, t: number): [number, number] {
  for (let i = 1; i < plan.stops.length; i++) {
    const a = plan.stops[i - 1]!
    const b = plan.stops[i]!
    if (t <= b.t) {
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
      return P(a.at[0] + (b.at[0] - a.at[0]) * k, a.at[1] + (b.at[1] - a.at[1]) * k, 0)
    }
  }
  return P(plan.stops[0]!.at[0], plan.stops[0]!.at[1], 0)
}

const pct = (plan: WalkPlan, t: number) => ((t / plan.period) * 100).toFixed(3) + '%'

/** The keyframes the walkers share: the route, and when each facing shows. */
function walkCss(plan: WalkPlan): string {
  const route = plan.stops
    .map(st => {
      const [x, y] = P(st.at[0], st.at[1], 0)
      return `${pct(plan, st.t)}{transform:translate(${f(x)}px,${f(y)}px)}`
    })
    .join('')
  let css = `@keyframes wroute{${route}}`
  for (const dir of ['px', 'nx', 'py', 'ny'] as const) {
    const frames = ['0%{opacity:0}']
    for (const leg of plan.legs.filter(l => l.dir === dir)) frames.push(`${pct(plan, leg.from)}{opacity:1}`, `${pct(plan, leg.to)}{opacity:0}`)
    if (plan.legs[0]!.dir === dir) frames[0] = '0%{opacity:1}'
    frames.push(`100%{opacity:${plan.legs[plan.legs.length - 1]!.dir === dir ? 1 : 0}}`)
    css += `@keyframes w${dir}{${frames.join('')}}`
  }
  return css
}

/** One walker, as its back-layer part, its front-layer part and its name tag. */
const BANTER = [
  'coffee? ☕',
  'ship it!',
  'lgtm 👍',
  'who broke main?',
  'tests are green ✓',
  'nice refactor!',
  'pizza friday? 🍕',
  'merge conflict 😅',
  'rubber duck time 🦆',
  'one more PR…',
  'brb, stretching',
  'great standup!',
]

/** Small talk on a walk: three lines taking turns, quiet in between. */
function banter(id: string, k: number): string {
  const s = seedOf(id)
  return [0, 1, 2]
    .map(i => {
      const line = BANTER[(s + i * 5 + k * 3) % BANTER.length] ?? 'hi!'
      return `<g class="say" style="animation-delay:-${(((k * 4.3 + i * 6) % 18) + 0.01).toFixed(2)}s">${speech(line, '#e9c46a')}</g>`
    })
    .join('')
}

function walker(a: OfficeAgent, plan: WalkPlan, phase: number, k = 0): { back: string; front: string; label: string } {
  const ch = character(a.character)
  const T = plan.period.toFixed(2)
  const delay = `-${phase.toFixed(2)}s`
  const [x, y] = placeAt(plan, phase)
  const mover = (inner: string) =>
    `<g style="transform:translate(${f(x)}px,${f(y)}px);animation:wroute ${T}s linear infinite ${delay}">${inner}</g>`
  const current = plan.legs.find(l => phase >= l.from && phase < l.to) ?? plan.legs[0]!
  const facing = (dir: Dir) =>
    `<g style="opacity:${current.dir === dir ? 1 : 0};animation:w${dir} ${T}s step-end infinite ${delay}">${walkerSprite(ch, dir)}</g>`
  const note = a.status === 'done' ? 'done ✓' : a.id === 'main' ? 'waiting for you' : 'coffee break'
  return {
    back: mover(facing('px') + facing('ny')),
    front: mover(facing('py') + facing('nx')),
    label: mover(at(0, -44, miniTag(ch.name, ch.accent, note)) + at(0, -54, banter(a.id, k))),
  }
}

// ---------------------------------------------------------------- sky and street

/** The sky behind the office, by the time of day. */
function cityDefs(light: Light): string {
  const isDusk = !light.isNight && light.glow > 0.4
  const sky: Record<string, [string, string]> = {
    night: ['#04060d', '#141c3a'],
    dusk: ['#2b1d45', '#ff8a5c'],
    dawn: ['#3b3f73', '#f7b2b8'],
    day: ['#5fa8dc', '#cfe8f7'],
  }
  const [top, bottom] = sky[light.isNight ? 'night' : isDusk ? 'dusk' : light.tint ? 'dawn' : 'day'] ?? ['#5fa8dc', '#cfe8f7']
  return `<linearGradient id="skybg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset=".75" stop-color="${bottom}"/></linearGradient>`
}

/** The sky's own lights: stars and the moon by night, the sun low at dusk. */
function skyLights(light: Light, minX: number, minY: number, W: number): string {
  if (light.isNight) {
    let s = ''
    for (let i = 0; i < 14; i++) {
      const k = seedOf('star' + i)
      s += r(minX + (k % Math.round(W)), minY + ((k >>> 9) % 90), 0.9, 0.9, '#fff', `class="tw" style="animation-delay:-${((k >>> 4) % 26) / 10}s" opacity=".8"`)
    }
    const mx = minX + W * 0.78
    return s + `<circle cx="${f(mx)}" cy="${f(minY + 24)}" r="16" fill="#f4f1de" opacity=".08"/><circle cx="${f(mx)}" cy="${f(minY + 24)}" r="7" fill="#f4f1de"/><circle cx="${f(mx + 3)}" cy="${f(minY + 22)}" r="6" fill="#0a0f22"/>`
  }
  if (light.glow > 0.4) return `<circle cx="${f(minX + W * 0.8)}" cy="${f(minY + 70)}" r="22" fill="#ff7b3d" opacity=".25"/><circle cx="${f(minX + W * 0.8)}" cy="${f(minY + 70)}" r="12" fill="#ffb067"/>`
  return `<circle cx="${f(minX + W * 0.82)}" cy="${f(minY + 26)}" r="20" fill="#fff6c9" opacity=".3"/><circle cx="${f(minX + W * 0.82)}" cy="${f(minY + 26)}" r="9" fill="#fff3b0"/>`
}

/**
 * The office's own city block, a slab with the office on it: sidewalks, a road
 * along both open sides with traffic, lamps, trees, cafes. Nothing behind it
 * but sky.
 */
function street(X: number, Y: number, light: Light, isLite: boolean, pools: Set<string>): { ground: string; front: string; lights: string; css: string } {
  const G = -7.05
  const far = -5
  const asphalt = light.isNight ? '#1a1d27' : '#3d424f'
  const walk = light.isNight ? '#3a3f4e' : '#b9bcc4'
  const earth = light.isNight ? '#2a2420' : '#6b5844'
  const E = 40
  const ground =
    // the block, a slab with its edge showing
    box(far, far, G - 9, X + E + 5, Y + E + 5, 8.9, asphalt, { top: asphalt, front: earth, side: shade(earth, -0.1) }) +
    // sidewalks along the office, and a curb on the far side of each road
    poly([[X, -5, G], [X + 10, -5, G], [X + 10, Y + 10, G], [X, Y + 10, G]], walk) +
    poly([[-5, Y, G], [X + 10, Y, G], [X + 10, Y + 10, G], [-5, Y + 10, G]], walk) +
    poly([[X + 36, -5, G], [X + E, -5, G], [X + E, Y + E, G], [X + 36, Y + E, G]], walk) +
    poly([[-5, Y + 36, G], [X + E, Y + 36, G], [X + E, Y + E, G], [-5, Y + E, G]], walk) +
    `<polyline points="${[P(X + 23, far, G), P(X + 23, Y + 23, G), P(far, Y + 23, G)].map(([a, b]) => f(a) + ',' + f(b)).join(' ')}" fill="none" stroke="#f4d35e" stroke-width=".9" stroke-dasharray="6 6" opacity=".8"/>` +
    // a crossing at the corner
    [0, 1, 2, 3, 4].map(i => poly([[X + 12 + i * 5, Y + 12, G], [X + 14.5 + i * 5, Y + 12, G], [X + 14.5 + i * 5, Y + 34, G], [X + 12 + i * 5, Y + 34, G]], '#e8e8e8', 'opacity=".55"')).join('')
  // lamps, trees and cars are drawn once here and placed by reference
  let front =
    `<defs><g id="lamp">${box(-0.6, -0.6, G, 1.2, 1.2, 28, '#2b2d42')}${box(-2, -2, G + 28, 4, 4, 2, '#2b2d42', { top: '#3a3d55' })}${box(-1.4, -1.4, G + 27, 2.8, 2.8, 1, light.glow > 0.3 ? '#fff1b8' : '#d9dce3')}</g>` +
    `<g id="tree">${box(-3, -3, G, 6, 6, 3, '#6d4a2b')}${box(-0.8, -0.8, G + 3, 1.6, 1.6, 7, '#5e3d22')}<g class="sway">${box(-4.5, -4.5, G + 9, 9, 9, 9, '#2f8a50', { top: '#4cb36f' })}${box(-3, -3, G + 18, 6, 6, 4, '#3a9d5d')}</g></g></defs>`
  front +=
    `<defs><g id="cafe">${box(-0.4, -0.4, G, 0.8, 0.8, 9, '#5e3d22')}${box(-3, -3, G + 6, 6, 6, 0.8, '#f4f1e8')}` +
    `${box(-8, -3, G, 3, 3, 4, '#c0603a')}${box(5, -3, G, 3, 3, 4, '#c0603a')}` +
    `${poly([[0, 0, G + 16], [-7, -7, G + 12], [7, -7, G + 12]], '#e63946')}${poly([[0, 0, G + 16], [7, -7, G + 12], [7, 7, G + 12]], '#f4f1e8')}` +
    `${poly([[0, 0, G + 16], [7, 7, G + 12], [-7, 7, G + 12]], '#e63946')}${poly([[0, 0, G + 16], [-7, 7, G + 12], [-7, -7, G + 12]], '#f4f1e8')}</g>` +
    `<g id="planter">${box(-5, -2.5, G, 10, 5, 4, '#8b5e3c', { top: '#6b4e33' })}${box(-4, -1.5, G + 4, 2.5, 2.5, 2.5, '#e63946')}${box(-1, -1.5, G + 4, 2.5, 2.5, 3, '#f4d35e')}${box(2, -1.5, G + 4, 2.5, 2.5, 2.5, '#ff8fab')}</g>` +
    `<g id="bench">${box(-6, -1.5, G + 3, 12, 3, 1, '#a8774d')}${box(-6, 1, G + 4, 12, 0.8, 4, '#a8774d')}${box(-5, -1.5, G, 1, 3, 3, '#2b2d42')}${box(4, -1.5, G, 1, 3, 3, '#2b2d42')}</g></defs>`
  let lights = ''
  const place = (id: string, x: number, y: number) => {
    const [px, py] = P(x, y, 0)
    front += at(px, py, `<use href="#${id}"/>`)
  }
  const lamp = (x: number, y: number) => {
    const [px, py] = P(x, y, 0)
    front += at(px, py, `<use href="#lamp"/>`)
    const [gx, gy] = P(x, y, G)
    if (light.glow > 0.3) lights += pool(pools, '#ffd59a', gx, gy, 22, 11, light.glow * 0.6)
  }
  const tree = (x: number, y: number) => {
    const [px, py] = P(x, y, 0)
    front += at(px, py, `<use href="#tree"/>`)
  }
  for (let y = 20, k = 0; y < Y; y += 64, k++) (k % 2 ? tree : lamp)(X + 6, y)
  for (let x = 30, k = 1; x < X; x += 64, k++) (k % 2 ? tree : lamp)(x, Y + 6)
  lamp(X + 6, Y + 6)
  // in between: cafe tables on the front sidewalk, planters and benches along the side one
  for (let x = 62, k = 0; x < X - 10; x += 64, k++) place(k % 2 ? 'planter' : 'cafe', x, Y + 6)
  for (let y = 52, k = 0; y < Y - 10; y += 64, k++) place(k % 2 ? 'bench' : 'planter', X + 6, y)
  // a garland of lights along the front street, swinging between the posts
  if (!isLite) {
    let d = ''
    for (let x = 30; x + 32 <= X; x += 32) {
      const [ax, ay] = P(x, Y + 6, G + 24)
      const [bx, by] = P(x + 32, Y + 6, G + 24)
      d += `${d ? '' : `M${f(ax)},${f(ay)}`} Q${f((ax + bx) / 2)},${f((ay + by) / 2 + 6)} ${f(bx)},${f(by)}`
    }
    if (d) {
      const glow = light.glow > 0.3
      front +=
        `<path d="${d}" fill="none" stroke="#2b2d42" stroke-width=".4"/>` +
        `<path d="${d}" fill="none" stroke="#ffd166" stroke-width="${glow ? 2.2 : 1.4}" stroke-dasharray=".1 5" stroke-linecap="round" class="tw"${glow ? '' : ' opacity=".8"'}/>` +
        `<path d="${d}" fill="none" stroke="#ff8fab" stroke-width="${glow ? 2.2 : 1.4}" stroke-dasharray=".1 5" stroke-dashoffset="2.5" stroke-linecap="round" class="tw" style="animation-delay:-1.3s"${glow ? '' : ' opacity=".8"'}/>`
    }
  }
  if (isLite) return { ground, front, lights, css: '' }
  // traffic: cars driving down the right-hand road and across the front one
  const COLORS = ['#e63946', '#f4d35e', '#4cc9f0', '#f1f1f1', '#2a9d8f', '#9b5de5']
  const beams = light.glow > 0.3
  const carDef = (id: string, alongX: boolean, c: string) =>
    `<g id="${id}">` +
    (alongX ? box(-6, -3, G, 12, 6, 3.5, c) + box(-3, -2.6, G + 3.5, 6, 5.2, 2.6, '#a8dadc') : box(-3, -6, G, 6, 12, 3.5, c) + box(-2.6, -3, G + 3.5, 5.2, 6, 2.6, '#a8dadc')) +
    (beams ? (alongX ? box(-6.4, -2.4, G + 1, 0.4, 4.8, 1, '#fff1b8') : box(-2.4, 6, G + 1, 4.8, 0.4, 1, '#fff1b8')) : '') +
    `</g>`
  front += `<defs>${carDef('carA', false, COLORS[0] ?? '#e63946')}${carDef('carB', false, COLORS[2] ?? '#4cc9f0')}${carDef('carC', true, COLORS[1] ?? '#f4d35e')}${carDef('carD', true, COLORS[4] ?? '#2a9d8f')}</defs>`
  const lane = (from: [number, number], to: [number, number], name: string) => {
    const [ax, ay] = P(from[0], from[1], 0)
    const [bx, by] = P(to[0], to[1], 0)
    return `@keyframes ${name}{0%{transform:translate(${f(ax)}px,${f(ay)}px);opacity:0}8%,92%{opacity:1}100%{transform:translate(${f(bx)}px,${f(by)}px);opacity:0}}`
  }
  const css = lane([X + 17, far], [X + 17, Y + E], 'cdn') + lane([X + 29, Y + E], [X + 29, far], 'cup') + lane([X + E, Y + 17], [far, Y + 17], 'cwe') + lane([far, Y + 29], [X + E, Y + 29], 'cea')
  let cars = ''
  for (const [name, def, secs, delay] of [
    ['cdn', 'carA', 11, 0],
    ['cdn', 'carB', 11, 6],
    ['cup', 'carA', 13, 3],
    ['cwe', 'carC', 12, 2],
    ['cea', 'carD', 10, 7],
    ['cea', 'carC', 10, 2],
  ] as const) {
    cars += `<g style="animation:${name} ${secs}s linear infinite -${delay}s"><use href="#${def}"/></g>`
  }
  return { ground, front: front + cars, lights, css }
}

// ---------------------------------------------------------------- basement

/** The server hall's depth (y), its height, and how far below the office it is drawn. */
const BD = 72
const BH = 44
/** Rack slots along each of the hall's two rows. */
const RACK_PITCH = 18

/** An idle rack: dark, a light or two ticking over. Drawn once, placed by reference. */
function idleRackDef(): string {
  let units = ''
  for (let i = 0; i < 4; i++) units += r(1, 2 + i * 8, 10, 6.5, '#13151c') + r(2.2, 4 + i * 8, 1.2, 1.2, '#2f6b4a', i % 2 ? 'class="led"' : '')
  return `<g id="rackIdle">${box(0, 0, 0, 12, 10, 36, '#23262f', { top: '#2d313c' })}${onFront(0, 10, 36, units)}</g>`
}

/**
 * The basement: a concrete server hall with a rack for every background task,
 * lit and labelled, and idle racks filling the rows. Drawn in its own frame,
 * world origin at its back corner; the caller places it under the office.
 */
function basement(X: number, tasks: BgTask[], agents: OfficeAgent[], now: number, light: Light, pools: Set<string>) {
  const CONCRETE = '#7a7f8c'
  const slots = Math.max(4, Math.floor((X - 30) / RACK_PITCH))
  const rows: { x: number; y: number }[] = []
  for (const y of [9, 44]) for (let i = 0; i < slots; i++) rows.push({ x: 16 + i * RACK_PITCH, y })
  const running = tasks.slice(0, rows.length)
  let body =
    // the slab, the two walls, and a floor of tiles
    box(-5, -5, -8, X + 5, BD + 5, 8, '#4a4e59', { top: '#5d626e', front: '#3c3f48', side: '#34363e' }) +
    poly([[0, 0, 0.05], [X, 0, 0.05], [X, BD, 0.05], [0, BD, 0.05]], 'url(#tiles)') +
    box(-5, -5, 0, X + 5, 5, BH, CONCRETE, { top: '#5a5e69', front: CONCRETE, side: shade(CONCRETE, -0.12) }) +
    box(-5, 0, 0, 5, BD, BH, shade(CONCRETE, -0.08), { top: '#5a5e69', front: shade(CONCRETE, -0.2), side: shade(CONCRETE, -0.08) }) +
    // pipes and a cable tray along the back wall, strip lights under the ceiling
    onFront(0, 0, BH - 3, r(0, 0, X, 2.4, '#b5523b') + r(0, 4, X, 1.6, '#3d8b8b') + r(0, 8, X, 3, '#2b2d42') + r(0, 8, X, 0.6, '#ffd166', 'opacity=".4"')) +
    onSide(0, 0, BH - 3, r(0, 0, BD, 2.4, '#9b4433') + r(0, 4, BD, 1.6, '#357a7a')) +
    [0.25, 0.5, 0.75].map(k => onFront(X * k - 10, 0, 6, r(0, 0, 20, 1.6, '#e8f4fd'))).join('') +
    // a sign: which floor this is
    onSideText(0, 54, 36, r(0, 0, 46, 13, '#1b1f2e', 'rx="1.5"') + `<text x="23" y="6" font-size="4.4" font-weight="700" fill="#7ee081" text-anchor="middle">B1 · SERVERS</text>` + `<text x="23" y="11" font-size="3.2" fill="#9aa3b5" text-anchor="middle">${running.length} task${running.length === 1 ? '' : 's'} running</text>`)
  let overlays = ''
  let lights = ''
  const tops = new Map<string, [number, number]>()
  // back row first, then the front; each slot either a running task's rack or an idle one
  const order = [...rows].sort((a, b) => a.y - b.y || a.x - b.x)
  order.forEach((slot, k) => {
    const [sx, sy] = P(slot.x, slot.y, 0)
    const t = running[k]
    if (!t) {
      body += at(sx, sy, `<use href="#rackIdle"/>`)
      return
    }
    const crew = t.runId ? agents.filter(a => a.group === t.runId && a.status !== 'done').length : 0
    const rk = rack(t, now, k, crew)
    body += at(sx, sy, rk.body)
    overlays += at(sx, sy, rk.overlay)
    if (t.runId) tops.set(t.runId, P(slot.x + 6, slot.y + 5, 36))
    const [gx, gy] = P(slot.x + 6, slot.y + 14, 0)
    lights += pool(pools, t.kind === 'workflow' ? '#c084fc' : '#3ddc84', gx, gy, 18, 9, 0.35 + light.glow * 0.3)
  })
  if (tasks.length > running.length) {
    const [sx, sy] = P(X - 30, BD - 6, 4)
    overlays += at(sx, sy, miniTag(`+${tasks.length - running.length} more`, '#9aa3b5', 'running'))
  }
  // the hall's own cool light, whatever the time of day
  for (const k of [0.25, 0.5, 0.75]) {
    const [lx, ly] = P(X * k, BD / 2, 0)
    lights += pool(pools, '#9fd3ff', lx, ly, 40, 20, 0.22)
  }
  return { body, overlays, lights, tops }
}

// ---------------------------------------------------------------- room

const WALL_H = 72
const MAX_WALKERS = 4
/** The drawing's markup must stay under the surface's bound for an Svg. */
const MAX_SOURCE = 125_000
export { MAX_DESKS }
export { CHAT_SHOW_MS }

// a sage room panelled in wood
const WALL = '#7f9c8a'
const WALL_SIDE = '#6f8a79'
const WALL_TOP = '#4c6355'
const PANEL = '#7a5233'
const PANEL_SIDE = '#6a4629'
const TRIM = '#b4865a'

export type RenderOptions = {
  theme?: Theme
  /** The local hour, 0-23, that 'auto' lights the office for. */
  hour?: number
  /** Lines said lately; the newest per speaker shows as a bubble. */
  chat?: ChatLine[]
  /** Leaves out the fairy lights and dust, for a crowded office near the size bound. */
  lite?: boolean
  /** Who is walking where: the lead, new crew, visits, you at the door. */
  stage?: Stage
  /** How much usage is spent, for the meter on the wall. */
  usage?: Usage
  /** The last resort near the size bound: the sky only, no street. */
  bare?: boolean
}

export function renderOffice(
  agents: OfficeAgent[],
  tasks: BgTask[],
  stats: OfficeStats,
  now: number,
  options: RenderOptions = {},
  maxWalkers = MAX_WALKERS,
): { source: string; width: number; height: number } {
  const out = drawOffice(agents, tasks, stats, now, options, maxWalkers)
  // a crowded office sends fewer people for a walk rather than outgrow the bound
  if (out.source.length <= MAX_SOURCE) return out
  if (maxWalkers > 0) return renderOffice(agents, tasks, stats, now, options, maxWalkers - 1)
  if (!options.lite) return renderOffice(agents, tasks, stats, now, { ...options, lite: true }, 0)
  if (options.stage) return renderOffice(agents, tasks, stats, now, { ...options, stage: undefined }, 0)
  return options.bare ? out : renderOffice(agents, tasks, stats, now, { ...options, bare: true }, 0)
}

/** A curved, flowing line from one point to another: who is working for whom. */
function link(from: [number, number], to: [number, number], color: string, k: number, strength = 1): string {
  const [x1, y1] = from
  const [x2, y2] = to
  const lift = 18 + Math.hypot(x2 - x1, y2 - y1) * 0.18
  const d = `M${f(x1)},${f(y1)} Q${f((x1 + x2) / 2)},${f(Math.min(y1, y2) - lift)} ${f(x2)},${f(y2)}`
  return (
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="4" opacity="${(0.18 * strength).toFixed(2)}"/>` +
    `<path class="flow" d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3" opacity="${(0.95 * strength).toFixed(2)}" style="animation-delay:-${(k * 0.27).toFixed(2)}s"/>` +
    `<circle cx="${f(x2)}" cy="${f(y2)}" r="2" fill="${color}"/>`
  )
}

/** A speech bubble, its tail at the origin. */
function speech(text: string, color: string, to?: string): string {
  const body = clip(text, 34)
  const w = (body.length + (to ? to.length + 2 : 0)) * 2.45 + 9
  return (
    `<g class="pop">` +
    `<rect x="${f(-w / 2)}" y="-12" width="${f(w)}" height="9.5" rx="4" fill="#fffdf6" stroke="${color}" stroke-width=".8"/>` +
    `<polygon points="-2.5,-2.9 2.5,-2.9 0,0.5" fill="#fffdf6"/>` +
    `<text x="${f(-w / 2 + 4.5)}" y="-5.6" font-size="4.2" fill="#2b2d42">${to ? `<tspan fill="${shade(color, -0.25)}" font-weight="700">@${esc(to)} </tspan>` : ''}${esc(body)}</text>` +
    `</g>`
  )
}

/** The break corner: a couch, a coffee table, a lamp, the coffee bar, a printer and files. */
function lounge(x0: number, y0: number, width: number): { couch: string; rest: string } {
  const COUCH = '#b5523b'
  const cushion = shade(COUCH, 0.06)
  const couch =
    // couch against the left wall, facing the room
    `<ellipse cx="${f(P(10, y0 + 24, 0)[0])}" cy="${f(P(10, y0 + 24, 0)[1])}" rx="26" ry="13" fill="#000" opacity=".15"/>` +
    box(1, y0 + 4, 0, 4, 40, 18, shade(COUCH, -0.08)) +
    box(4, y0 + 4, 0, 14, 40, 7, COUCH) +
    box(5, y0 + 6, 7, 12, 18, 3, cushion) +
    box(5, y0 + 25, 7, 12, 17, 3, cushion) +
    box(5, y0 + 8, 10, 3, 7, 6, '#f4d35e') +
    box(5, y0 + 33, 10, 3, 7, 6, '#8ecae6') +
    box(4, y0 + 1, 0, 14, 4, 12, shade(COUCH, -0.04))
  let s =
    box(4, y0 + 43, 0, 14, 4, 12, shade(COUCH, -0.04)) +
    // coffee table, two mugs and a book
    box(25, y0 + 12, 0, 2, 2, 6, '#5e3d22') +
    box(39, y0 + 32, 0, 2, 2, 6, '#5e3d22') +
    box(24, y0 + 10, 6, 18, 26, 2, '#9c6b3f', { top: '#b07c4b' }) +
    box(28, y0 + 14, 8, 3, 3, 4, '#f1f1f1', { top: '#6b3e26' }) +
    box(34, y0 + 26, 8, 3, 3, 4, '#ffd166', { top: '#6b3e26' }) +
    box(30, y0 + 22, 8, 7, 5, 1.4, '#457b9d') +
    // floor lamp at the couch's end
    box(5, y0 + 48, 0, 5, 5, 1, '#2b2d42') +
    box(7, y0 + 50, 1, 1.2, 1.2, 30, '#2b2d42') +
    box(3.5, y0 + 46.5, 29, 8, 8, 7, '#f6d7a7', { top: '#fff1cf', front: '#f6d7a7', side: '#e8c38f' })
  // the coffee bar along the front
  const bx = x0 + 52
  if (bx + 46 < width) {
    s +=
      box(bx, y0 + 36, 0, 44, 12, 18, '#6d4a2b', { top: '#d9c7a8' }) +
      onFront(bx, y0 + 48, 18, r(2, 3, 18, 12, '#5e3f24') + r(24, 3, 18, 12, '#5e3f24') + r(10, 8, 3, 1, TRIM) + r(32, 8, 3, 1, TRIM)) +
      box(bx + 4, y0 + 38, 18, 9, 8, 13, '#2b2d42', { top: '#3a3d55' }) +
      box(bx + 6, y0 + 45.8, 22, 5, 0.6, 4, '#c0c4d0') +
      box(bx + 7, y0 + 44, 18, 3, 3, 3.5, '#f1f1f1', { top: '#6b3e26' }) +
      onFront(bx + 4, y0 + 46, 30, r(1.5, 1.5, 1.2, 1.2, '#3ddc84', 'class="led"')) +
      at(...P(bx + 8.5, y0 + 45.5, 22), `<g class="steam">${r(-1, -4, 0.8, 3, '#ffffffaa')}${r(1, -6, 0.8, 3, '#ffffffaa')}</g>`) +
      box(bx + 18, y0 + 40, 18, 6, 6, 7, '#c0603a') +
      box(bx + 19, y0 + 41, 25, 4, 4, 1, '#3a2a1a') +
      [0, 1, 2].map(i => box(bx + 28 + i * 4.5, y0 + 41 + (i % 2), 18, 3, 3, 4, ['#e63946', '#f1f1f1', '#2a9d8f'][i] ?? '#fff', { top: '#3a2a1a' })).join('') +
      `<g class="sway">${box(bx + 38, y0 + 39, 18, 4, 4, 9, '#3a9d5d')}</g>`
  }
  // printer on a cabinet, and the filing cabinets
  const px = x0 + 98
  if (px + 34 < width) {
    s +=
      box(px, y0 + 34, 0, 16, 14, 14, '#c9ccd4') +
      box(px + 1, y0 + 35, 14, 14, 12, 7, '#e8eaf0', { top: '#f5f6f9' }) +
      box(px + 3, y0 + 37, 21, 10, 7, 0.6, '#ffffff') +
      onFront(px + 1, y0 + 47, 21, r(10, 1.5, 1.3, 1.3, '#3ddc84', 'class="led"') + r(2, 2, 6, 1, '#9aa3b5')) +
      box(px + 20, y0 + 34, 0, 13, 14, 26, '#7d8597', { top: '#949cad' }) +
      onFront(px + 20, y0 + 48, 26, [0, 1, 2].map(i => r(1.5, 1.5 + i * 8.2, 10, 7, '#6b7385') + r(4.5, 4 + i * 8.2, 4, 1.2, '#cfd4de')).join(''))
  }
  return { couch, rest: s }
}

/**
 * Your office: a glass-walled corner room with your desk, where you sit; while
 * you have just sent a prompt it shows over your head.
 */
function yourOffice(L: Layout, said: string | undefined, sinceS: number): { glass: string; inside: string; talk: string } {
  const { ox0, X, Y, Yd, officeDoorX: d } = L
  const y0 = Yd + 2
  const GLASS = '#bfe3ee'
  const FRAME = '#3d3a4b'
  const pane = (len: number) =>
    r(0, 0, len, 28, GLASS, 'opacity=".22"') + r(0, 0, len, 1.6, FRAME) + r(0, 26.4, len, 1.6, FRAME) + r(0, 12, len, 0.8, '#ffffff', 'opacity=".35"')
  const glass =
    // floor: a soft rug
    poly([[ox0 + 4, y0 + 6, 0.06], [X - 4, y0 + 6, 0.06], [X - 4, Y - 4, 0.06], [ox0 + 4, Y - 4, 0.06]], '#6d597a', 'opacity=".45"') +
    // the back wall of glass, with its door gap, and the left one
    onFront(ox0, y0, 28, pane(d - 7 - ox0) + r(0, 0, 1.6, 28, FRAME)) +
    onFront(d + 7, y0, 28, pane(X - d - 7) + r(0, 0, 1.6, 28, FRAME) + `<text x="${f((X - d - 7) / 2)}" y="9" font-size="3.6" font-weight="700" fill="${FRAME}" text-anchor="middle" opacity=".8">YOUR OFFICE</text>`) +
    onSide(ox0, y0, 28, pane(Y - y0) + r(0, 0, 1.6, 28, FRAME))
  const dx = L.yourX
  const inside =
    // a bookshelf against the glass, and a big plant
    box(X - 14, y0 + 3, 0, 10, 6, 26, '#7a5230', { top: '#8f6239' }) +
    onFront(X - 14, y0 + 9, 26, [0, 1, 2].map(i => r(1, 2 + i * 8, 8, 6, ['#e63946', '#457b9d', '#e9c46a'][i] ?? '#457b9d')).join('')) +
    box(ox0 + 26, y0 + 3, 0, 7, 7, 7, '#c0603a') +
    `<g class="sway">${box(ox0 + 27.5, y0 + 4.5, 7, 4, 4, 13, '#3a9d5d')}${box(ox0 + 26, y0 + 6, 7, 3, 3, 9, '#4cb36f')}</g>` +
    // your chair, you, and your desk with a laptop and a mug
    box(dx - 7, y0 + 2, 0, 14, 4, 30, '#2b2d42', { top: '#3a3d55' }) +
    at(...P(dx, y0 + 10, 0), `<g transform="translate(0 5)">${walkerSprite(YOU, 'py', 'stand')}</g>`) +
    box(dx - 16, y0 + 16, 0, 2.5, 12, 15, '#5e3d22') +
    box(dx + 13.5, y0 + 16, 0, 2.5, 12, 15, '#5e3d22') +
    box(dx - 17, y0 + 15, 15, 34, 14, 2.4, '#8b5e3c', { top: '#a8774d' }) +
    box(dx - 5, y0 + 19, 17.4, 11, 7, 0.8, '#c0c4d0') +
    box(dx - 5, y0 + 18.2, 17.4, 11, 0.8, 7, '#2b2d42', { side: '#3a3d55' }) +
    box(dx + 9, y0 + 20, 17.4, 3, 3, 4, '#ffd166', { top: '#6b3e26' }) +
    box(dx - 14, y0 + 19, 17.4, 4, 4, 1, '#333') +
    box(dx - 12.5, y0 + 20.5, 18.4, 1, 1, 8, '#555') +
    box(dx - 14.5, y0 + 19, 26, 5, 4, 3, '#e9c46a') +
    // the name plate: a walnut block with a brass face
    box(dx - 8, y0 + 25.5, 17.4, 16, 2.6, 4.4, '#5e3d22', { top: '#7a5230' }) +
    onFront(dx - 8, y0 + 28.1, 21.8, r(0.8, 0.6, 14.4, 3.2, '#d4a72c') + r(0.8, 0.6, 14.4, 0.6, '#f5d77a') + `<text x="8" y="3.2" font-size="2.6" font-weight="700" fill="#2b1d0e" text-anchor="middle" letter-spacing=".5">CEO</text>`)
  // up and to the right of your head, clear of whoever stands at your desk
  const [hx0, hy0] = P(dx, y0 + 10, 40)
  const [hx, hy] = [hx0 + 26, hy0 - 12]
  let talk = `<path d="M${f(hx0 + 3)},${f(hy0 + 2)} L${f(hx - 6)},${f(hy)}" stroke="${YOU.accent}" stroke-width=".6" opacity=".7"/>` + at(hx, hy, miniTag('👑 You', '#fbbf24', said ? 'CEO · just asked' : 'CEO'))
  if (said) talk += at(hx, hy - 10, `<g class="say1" style="animation-delay:-${sinceS.toFixed(2)}s">${speech(said, YOU.accent)}</g>`)
  return { glass, inside, talk }
}

/** The office door on the left wall, open while someone comes in. */
function door(y: number, isOpen: boolean): string {
  return (
    (isOpen ? poly([[0.5, y, 0.05], [0.5, y + 16, 0.05], [14, y + 22, 0.05], [14, y - 2, 0.05]], '#fff3c4', 'opacity=".22"') : '') +
    onSide(
      0,
      y,
      32,
      r(-1.6, -1.6, 19.2, 33.6, '#5e3d22') +
        r(0, 0, 16, 32, isOpen ? '#20253a' : '#a8774d') +
        (isOpen
          ? r(0, 0, 3, 32, '#8b5e3c')
          : r(2, 3, 12, 11, 'none', 'stroke="#8b5e3c" stroke-width=".8"') + r(2, 17, 12, 12, 'none', 'stroke="#8b5e3c" stroke-width=".8"') + `<circle cx="13" cy="17" r="1" fill="#f4d35e"/>`),
    ) +
    // the sign over it, readable from the room
    onSideText(0, y + 13, 38.5, r(0, 0, 10, 4, '#1b1f2e', 'rx="1"') + `<text x="5" y="3" font-size="2.6" fill="#7ee081" text-anchor="middle">EXIT</text>`)
  )
}

/** The lead's sketch of the plan on the whiteboard, drawn stroke by stroke from `t0` seconds in. */
function planSketch(names: { name: string; color: string }[], elapsed: number, t0: number): string {
  const ink = (k: number) => `style="animation-delay:${(t0 + k * 0.8 - elapsed).toFixed(2)}s"`
  const crew = names.slice(0, 4)
  const bw = 17
  const gap = crew.length ? (78 - crew.length * bw) / (crew.length + 1) : 0
  let s =
    r(1.5, 1.5, 81, 35, '#fbfbf8') +
    `<text class="inkt" x="5" y="8.5" font-size="5" font-weight="700" fill="#2b2d42" ${ink(0)}>THE PLAN ✎</text>` +
    `<rect class="ink" x="33" y="11" width="18" height="7" rx="1.5" fill="none" stroke="#d97757" stroke-width=".8" ${ink(0.5)}/>` +
    `<text class="inkt" x="42" y="16" font-size="3.6" fill="#d97757" text-anchor="middle" ${ink(1)}>Claude</text>`
  crew.forEach((c, i) => {
    const x = 3 + gap + i * (bw + gap)
    const cx = x + bw / 2
    s +=
      `<path class="ink" d="M42,18 L42,22 L${f(cx)},22 L${f(cx)},26" fill="none" stroke="#2b2d42" stroke-width=".6" ${ink(1.5 + i)}/>` +
      `<rect class="ink" x="${f(x)}" y="26" width="${bw}" height="7" rx="1.5" fill="none" stroke="${c.color}" stroke-width=".8" ${ink(1.8 + i)}/>` +
      `<text class="inkt" x="${f(cx)}" y="31" font-size="3.4" fill="${shade(c.color, -0.2)}" text-anchor="middle" ${ink(2.2 + i)}>${esc(clip(c.name, 8))}</text>`
  })
  return s
}


function drawOffice(
  agents: OfficeAgent[],
  tasks: BgTask[],
  stats: OfficeStats,
  now: number,
  options: RenderOptions,
  maxWalkers: number,
): { source: string; width: number; height: number } {
  const phase = phaseOf(options.theme ?? 'auto', options.hour ?? 12)
  const light = LIGHT[phase]
  const pools = new Set<string>()
  const L: Layout = layout(agents, tasks)
  const { shown, cols, rows, X, Yd, Y, wy } = L
  // who is on their feet by the stage: the lead, new crew, visits, you at the door
  const actors = maxWalkers >= 0 ? standing(stageActors(L, options.stage, now), now) : []
  const onStage = new Set(actors.map(a => a.id))
  // nobody busy walks: those idle or done stretch their legs; the lead has the stage
  const strollers = shown
    .filter(a => (a.status === 'idle' || a.status === 'done') && a.id !== 'main' && !onStage.has(a.id))
    .slice(0, maxWalkers)
  const away = new Set([...strollers.map(a => a.id), ...onStage])
  const painted: Painted = { layers: new Map(), labels: '', css: '' }
  const sprites = new Map<string, string>()
  actors.forEach((a, k) => paintActor(a, now, String(k), sprites, painted))
  const layer = (name: string) => painted.layers.get(name) ?? ''

  // window openings: on the back wall between the neon sign and the clock, on
  // the left wall a big one, a second before the door, and one over the couch
  const backHoles: Opening[] = X - 48 - 156 >= 18 ? [{ a: 156, b: X - 48, z0: 28, z1: 62 }] : []
  const leftHoles: Opening[] = [{ a: wy - 4, b: wy + 50, z0: 28, z1: 64 }]
  if (L.doorY - 8 - (wy + 60) >= 18) leftHoles.push({ a: wy + 60, b: L.doorY - 8, z0: 30, z1: 62 })
  leftHoles.push({ a: Yd + 8, b: Y - 8, z0: 32, z1: 62 })

  // walls, wood panelling and floor
  let room =
    box(0, 0, -7, X, Y, 7, '#6b4e33', { top: 'url(#planks)', front: '#6b4e33', side: '#5a412a' }) +
    poly([[-5, -5, WALL_H], [X, -5, WALL_H], [X, 0, WALL_H], [-5, 0, WALL_H]], WALL_TOP) +
    poly([[X, -5, 0], [X, 0, 0], [X, 0, WALL_H], [X, -5, WALL_H]], shade(WALL_SIDE, -0.1)) +
    wallFace(true, -5, X, WALL_H, backHoles, 'url(#brF)') +
    poly([[-5, 0, WALL_H], [0, 0, WALL_H], [0, Y, WALL_H], [-5, Y, WALL_H]], WALL_TOP) +
    poly([[-5, Y, 0], [0, Y, 0], [0, Y, WALL_H], [-5, Y, WALL_H]], shade(WALL_SIDE, -0.15)) +
    wallFace(false, 0, Y, WALL_H, leftHoles, 'url(#brS)') +
    onFront(0, 0, 24, r(0, 0, X, 24, PANEL) + r(0, 0, X, 1.6, TRIM) + r(0, 21, X, 3, '#3e2a19') + Array.from({ length: Math.floor(X / 22) }, (_, i) => r(i * 22 + 4, 4, 15, 14, 'none', `stroke="${shade(PANEL, 0.07)}" stroke-width=".6"`)).join('')) +
    onSide(0, 0, 24, r(0, 0, Y, 24, PANEL_SIDE) + r(0, 0, Y, 1.6, shade(TRIM, -0.1)) + r(0, 21, Y, 3, '#33220f') + Array.from({ length: Math.floor(Y / 22) }, (_, i) => r(i * 22 + 4, 4, 15, 14, 'none', `stroke="${shade(PANEL_SIDE, 0.07)}" stroke-width=".6"`)).join('')) +
    // crown moulding
    onFront(0, 0, WALL_H, r(0, 0, X, 2, TRIM)) +
    onSide(0, 0, WALL_H, r(0, 0, Y, 2, shade(TRIM, -0.1))) +
    // a rug under the desks and one in the break corner
    poly([[MX - 6, MY + 40, 0.05], [MX + cols * STEP_X - 6, MY + 40, 0.05], [MX + cols * STEP_X - 6, Yd - 24, 0.05], [MX - 6, Yd - 24, 0.05]], '#8c3b2f', 'opacity=".28"') +
    poly([[MX - 2, MY + 44, 0.06], [MX + cols * STEP_X - 10, MY + 44, 0.06], [MX + cols * STEP_X - 10, Yd - 28, 0.06], [MX - 2, Yd - 28, 0.06]], 'none', 'stroke="#e9c46a" stroke-opacity=".3" stroke-width=".8" stroke-dasharray="2 2"') +
    poly([[18, Yd + 6, 0.05], [50, Yd + 6, 0.05], [50, Yd + 44, 0.05], [18, Yd + 44, 0.05]], '#2a6f6b', 'opacity=".45"') +
    poly([[21, Yd + 9, 0.06], [47, Yd + 9, 0.06], [47, Yd + 41, 0.06], [21, Yd + 41, 0.06]], 'none', 'stroke="#f4e9d8" stroke-opacity=".35" stroke-width=".8"')

  room += onFront(12, 0, 64, board(agents, tasks, stats))
  // while the lead holds a huddle, the plan goes up on the board
  const stage = options.stage
  if (stage?.lead.mode === 'huddle') {
    const names = stage.crew.map(c => shown.find(a => a.id === c.id)).filter((a): a is OfficeAgent => a !== undefined).map(a => ({ name: character(a.character).name, color: character(a.character).accent }))
    room += onFront(12, 0, 64, planSketch(names, (now - stage.lead.since) / 1000, 3))
  }
  room += door(L.doorY, actors.some(a => a.key.startsWith('in') && (now - a.start) / 1000 < (a.legs[0]?.to ?? 0) + 0.6))
  // the wall clock keeps your local time: each hand starts where the time is and turns at its real pace
  const secs = localSeconds(now)
  const hand = (period: number, timing: string) => `style="animation:spin ${period}s ${timing} infinite -${(secs % period).toFixed(1)}s"`
  const ticks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    .map(i => `<rect x="${i % 3 ? 10.7 : 10.4}" y="1.8" width="${i % 3 ? 0.6 : 1.2}" height="${i % 3 ? 1.2 : 2}" fill="#5e3d22" transform="rotate(${i * 30} 11 11)"/>`)
    .join('')
  room += onFront(
    X - 42,
    0,
    64,
    `<svg width="22" height="22" viewBox="0 0 22 22" overflow="visible"><circle cx="11" cy="11" r="10" fill="#f5f1e6" stroke="#5e3d22" stroke-width="1.6"/>` +
      ticks +
      r(10.3, 5.6, 1.4, 5.8, '#2e3548', `class="hand" ${hand(43_200, 'linear')}`) +
      r(10.5, 3.2, 1, 8, '#2e3548', `class="hand" ${hand(3600, 'linear')}`) +
      r(10.7, 2.6, 0.6, 10, '#e63946', `class="hand" ${hand(60, 'steps(60)')}`) +
      `<circle cx="11" cy="11" r="1.3" fill="#2e3548"/></svg>`,
  )
  // the usage meter under the clock: a battery of what is left, amber when low, red and blinking when nearly out
  if (options.usage) room += onFront(X - 47, 0, 40, usageMeter(options.usage))
  // the windows themselves: glass, frames, sills with plants, curtains on the side wall
  backHoles.forEach((h, i) => (room += windowDressing(true, h, i)))
  leftHoles.forEach((h, i) => (room += windowDressing(false, h, i + 2)))
  // water cooler and a corner plant
  room +=
    box(4, 4, 0, 9, 9, 17, '#e8ecf2') +
    box(5.5, 5.5, 17, 6, 6, 10, '#7ec8f0', { top: '#a8dcf7', front: '#7ec8f0cc', side: '#5fb3e0cc' }) +
    box(X - 15, 4, 0, 10, 10, 10, '#c0603a') +
    `<g class="sway">${box(X - 13, 6, 10, 4, 4, 14, '#3a9d5d')}${box(X - 14.5, 8, 10, 3, 3, 9, '#4cb36f')}${box(X - 9.5, 5.5, 10, 3, 3, 11, '#2f8a50')}</g>`

  // everything standing on the floor, back to front
  type Item = { key: number; ox: number; oy: number; body: string; overlay: string }
  const items: Item[] = []
  // where each seated agent's head and tag are on screen
  const heads = new Map<string, [number, number]>()
  const tagsAt = new Map<string, [number, number]>()
  // agents walking to their own desk, and how many seconds until they sit down
  const arriving = new Map<string, number>()
  for (const a of actors) if (a.seatedAt !== undefined && !a.leaves) arriving.set(a.id, a.seatedAt - (now - a.start) / 1000)
  const arrivingTags = new Map<string, [number, number]>()
  let lights = ''
  for (let i = 0; i < rows * cols; i++) {
    const ox = MX + (i % cols) * STEP_X
    const oy = MY + Math.floor(i / cols) * STEP_Y
    const agent = shown[i]
    const isAway = agent !== undefined && away.has(agent.id)
    const sitsIn = agent ? arriving.get(agent.id) : undefined
    let s = station(agent, now, isAway)
    if (agent && sitsIn !== undefined && sitsIn > 0) {
      // the empty chair until it gets here, then the agent at work
      const there = station(agent, now, false)
      const d = `style="animation-delay:${sitsIn.toFixed(2)}s"`
      s = { body: `<g class="hide" ${d}>${s.body}</g><g class="show" ${d}>${there.body}</g>`, overlay: `${s.overlay}<g class="show" ${d}>${there.overlay}</g>` }
      arrivingTags.set(agent.id, P(ox + 30, oy + 36, 48))
    }
    items.push({ key: ox + oy, ox, oy, ...s })
    if (!agent || isAway) continue
    heads.set(agent.id, P(ox + 30, oy + 36, 40))
    tagsAt.set(agent.id, P(ox + 30, oy + 36, 48))
    const isLive = agent.status !== 'idle' && agent.status !== 'done'
    // the screen lights the desk and the face in front of it; a desk lamp the floor
    const [mx, my] = P(ox + 29, oy + 20, 24)
    if (isLive) lights += pool(pools, STATUS_COLOR[agent.status], mx, my, 26, 16, light.glow)
    const [lx, ly] = P(ox + 30, oy + 30, 0)
    if (light.glow > 0.3) lights += pool(pools, '#ffd59a', lx, ly, 34, 17, light.glow * 0.4)
  }
  items.sort((a, b) => a.oy - b.oy || a.ox - b.ox)
  let bodies = ''
  let overlays = ''
  items.forEach((it, i) => {
    const [sx, sy] = P(it.ox, it.oy, 0)
    bodies += at(sx, sy, it.body)
    if (it.overlay) overlays += at(sx, sy, it.overlay)
    const next = items[i + 1]
    if (!next || next.oy !== it.oy) bodies += layer('row' + Math.round((it.oy - MY) / STEP_Y))
  })

  // the walkers: behind the desks on the back and left aisles, in front on the others
  const plan = walkPlan(MX + cols * STEP_X - 2, Yd - 10)
  let walkBack = ''
  let walkFront = ''
  strollers.forEach((a, k) => {
    // phase from the wall clock, so a redraw picks up where the walk was
    const phase = (now / 1000 + (k * plan.period) / strollers.length) % plan.period
    const w = walker(a, plan, phase, k)
    walkBack += w.back
    walkFront += w.front
    overlays += w.label
  })

  // the basement: the server hall, drawn under the office in its own frame
  const TY = (X + Y) / 2 + 56 + BH - 24
  const hall = basement(X, tasks, agents, now, light, pools)
  const down = (inner: string) => `<g transform="translate(0 ${f(TY)})">${inner}</g>`
  overlays += down(hall.overlays)
  lights += down(hall.lights)
  const rackTops = new Map<string, [number, number]>()
  for (const [id, [x, y]] of hall.tops) rackTops.set(id, [x, y + TY])
  // a glass lift shaft between the floors, a car riding it
  const [shx] = P(8, BD - 14, 0)
  const shTop = (8 + BD - 14) / 2 + 16
  const shBottom = TY + (8 + BD - 14) / 2 - BH
  const shaft =
    `<rect x="${f(shx - 8)}" y="${f(shTop)}" width="16" height="${f(shBottom - shTop)}" fill="#bfe3ee" opacity=".35" stroke="#3d3a4b" stroke-width="1.4"/>` +
    `<rect x="${f(shx - 0.5)}" y="${f(shTop)}" width="1" height="${f(shBottom - shTop)}" fill="#3d3a4b" opacity=".6"/>` +
    `<g style="animation:lift 14s ease-in-out infinite alternate"><rect x="${f(shx - 6)}" y="${f(shTop + 4)}" width="12" height="16" rx="1.5" fill="#e0b04e" stroke="#7a5a1e" stroke-width=".8"/>` +
    `<rect x="${f(shx - 4)}" y="${f(shTop + 7)}" width="8" height="6" fill="#fff6c9" opacity=".8"/></g>`
  const liftCss = `@keyframes lift{0%,15%{transform:translateY(0)}85%,100%{transform:translateY(${f(shBottom - shTop - 24)}px)}}`
  if (agents.length > shown.length) {
    const [sx, sy] = P(MX + 4, Yd, 4)
    overlays += at(sx, sy, miniTag(`+${agents.length - shown.length} more agents`, '#9aa3b5', 'off screen'))
  }

  // the break corner, in front of everything else on the floor, and your office
  const corner = lounge(MX, Yd, L.ox0 - 4)
  const visitor = stage?.visitor
  const asked = visitor && now - visitor.since < GREET_MS ? visitor : undefined
  const mine = yourOffice(L, asked?.text, asked ? (now - asked.since) / 1000 : 0)
  const [ux, uy] = P(L.yourX - 14, Yd + 22, 26)
  lights += pool(pools, '#ffd59a', ux, uy, 26, 14, 0.15 + light.glow * 0.5)
  const [fx, fy] = P(7, Yd + 50, 30)
  lights += pool(pools, '#ffd59a', fx + 14, fy + 22, 34, 18, 0.25 + light.glow * 0.6)
  const [cx, cy] = P(MX + 74, Yd + 42, 24)
  if (light.glow > 0.3) lights += pool(pools, '#ffb37a', cx, cy, 30, 14, light.glow * 0.35)

  // who is working for whom: the lead to each busy subagent, a workflow's agents to its rack
  let links = ''
  const lead = heads.get('main')
  const crowd = shown.filter(a => a.id !== 'main' && a.status !== 'idle' && a.status !== 'done').length
  shown.forEach((a, k) => {
    if (a.id === 'main' || a.status === 'idle' || a.status === 'done') return
    const head = heads.get(a.id)
    if (!head) return
    const from = a.group ? rackTops.get(a.group) : lead
    if (from) links += link(from, head, character(a.character).accent, k, crowd > 5 ? 0.6 : 1)
  })

  // what was said lately, or is about to be: each bubble shows for its own while and fades by itself
  let talk = ''
  for (const line of options.chat ?? []) {
    if (now - line.at > CHAT_SHOW_MS) continue
    const spot = tagsAt.get(line.from) ?? arrivingTags.get(line.from)
    if (!spot) continue
    const to = line.toCharacter !== undefined ? character(line.toCharacter).name : undefined
    talk += at(spot[0], spot[1] - 17, `<g class="bub" style="animation-delay:${((line.at - now) / 1000).toFixed(2)}s">${speech(line.text, character(line.character).accent, to)}</g>`)
  }

  // the window's light across the floor, and dust drifting in it by day
  const [bc, bo] = light.beam
  lights += poly([[0.5, wy, 0.05], [0.5, wy + 46, 0.05], [36, wy + 64, 0.05], [36, wy + 18, 0.05]], bc, `opacity="${bo * 2}"`)
  if (!light.isNight && !options.lite) {
    for (let i = 0; i < 6; i++) {
      const [dx, dy] = P(6 + i * 5, wy + 12 + ((i * 7) % 26), 12 + ((i * 11) % 22))
      lights += `<circle class="mote" cx="${f(dx)}" cy="${f(dy)}" r=".7" fill="#fff" style="animation-delay:-${(i * 1.5).toFixed(1)}s"/>`
    }
  }

  // the frame takes in the whole block and a strip of sky over the walls
  const minX = -Y - 54
  const maxX = X + 54
  const minY = -WALL_H - 18
  const maxY = TY + (X + BD) / 2 + 14
  const city = options.bare ? { ground: '', front: '', lights: '', css: '' } : street(X, Y, light, !!options.lite, pools)
  lights += city.lights
  const W = maxX - minX
  const H = maxY - minY
  const full = (fill: string, extra = '') => `<rect x="${f(minX)}" y="${f(minY)}" width="${f(W)}" height="${f(H)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`
  const tint = light.tint ? full(light.tint[0], `opacity="${light.tint[1]}" style="mix-blend-mode:multiply"`) : ''
  const sky =
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light.sky[0]}"/><stop offset="1" stop-color="${light.sky[1]}"/></linearGradient>` +
    poolDefs(pools) +
    cityDefs(light)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(minX)} ${f(minY)} ${f(W)} ${f(H)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0d0f16">` +
    `<style>${CSS}${strollers.length ? walkCss(plan) : ''}${painted.css}${city.css}${liftCss}</style><defs>${DEFS}${sky}${[...sprites.values()].join('')}</defs>` +
    full('url(#skybg)') +
    skyLights(light, minX, minY, W) +
    shaft +
    down(hall.body) +
    city.ground +
    room +
    layer('back') +
    walkBack +
    bodies +
    walkFront +
    corner.couch +
    layer('lounge') +
    corner.rest +
    mine.glass +
    mine.inside +
    layer('office') +
    city.front +
    tint +
    `<g style="mix-blend-mode:screen">${lights}</g>` +
    (options.lite ? '' : stringLights(X, Y, light)) +
    neon(104, light) +
    full('url(#vig)') +
    links +
    overlays +
    mine.talk +
    painted.labels +
    talk +
    `</svg>`
  return { source, width: W, height: H }
}

export function describeOffice(agents: OfficeAgent[], tasks: BgTask[]): string {
  const people = agents.map(a => `${character(a.character).name} (${subtitle(a)}) ${activityLine(a)}`)
  const jobs = tasks.map(t => `task: ${t.label}`)
  return people.length + jobs.length === 0 ? 'An empty office.' : 'Agent office: ' + [...people, ...jobs].join('; ')
}

// ---------------------------------------------------------------- homes

/** What each agent does at home, by its place in the cast; the lead always sleeps it off. */
type Pastime = 'sleep' | 'sofa' | 'cook' | 'game' | 'read'
const PASTIMES: Pastime[] = ['sleep', 'sofa', 'cook', 'game', 'read', 'sofa']
const PASTIME_LINE: Record<Pastime, string> = {
  sleep: 'recharging… zzz',
  sofa: 'watching a show',
  cook: 'cooking dinner',
  game: 'playing games',
  read: 'reading with a tea',
}

const PLOT = 84
const HOME = 60
const HOME_H = 36

/** A clock time as people read it: 4:30 PM. */
export function clockTime(ms: number): string {
  try {
    const d = new Date(ms)
    const h = d.getHours()
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`
  } catch {
    return ''
  }
}

/** Lying in bed under a blanket in the agent's colour, head on the pillow. */
function sleeper(ch: Character): string {
  return (
    box(10, 8, 0, 34, 20, 6, '#8b5e3c', { top: '#a8774d' }) +
    box(8, 8, 0, 2.5, 20, 14, '#6d4a2b') +
    box(11, 9, 6, 32, 18, 3, '#f4f1e8') +
    box(12, 11, 9, 8, 14, 2.5, '#ffffff') +
    box(20, 9, 9, 22, 18, 4, ch.shirt, { top: shade(ch.shirt, 0.12) }) +
    box(13, 14, 11.5, 7, 8, 6, ch.hair, { front: ch.skin, side: ch.skin, top: ch.hair }) +
    at(...P(16, 18, 26), `<g class="zz"><text font-size="6" font-weight="700" fill="#cdb4ff">z</text><text x="4" y="-5" font-size="8" font-weight="700" fill="#cdb4ff">Z</text></g>`)
  )
}

/** One home: a cutaway room on its plot, its owner doing something cozy in it. */
function home(charIndex: number, k: number, light: Light): { body: string; label: string } {
  const ch = character(charIndex)
  const pastime = charIndex === 0 ? 'sleep' : (PASTIMES[k % PASTIMES.length] ?? 'sofa')
  const wall = ['#e6c99a', '#d4838f', '#7fa99b', '#e0b04e', '#8c6d9e', '#c8735a'][k % 6] ?? '#e6c99a'
  const floor = ['#c79d6d', '#a8774d', '#d9b38c'][k % 3] ?? '#c79d6d'
  let s =
    // the yard, the floor, and two walls with a window each
    box(-8, -8, -4, PLOT - 8, PLOT - 8, 4, '#5b8a3c', { top: '#6fa14a', front: '#4a3a2a', side: '#3d3022' }) +
    box(0, 0, 0, HOME, HOME, 2, floor, { top: floor, front: shade(floor, -0.3), side: shade(floor, -0.38) }) +
    box(-3, -3, 2, HOME + 3, 3, HOME_H, wall, { top: shade(wall, -0.25), front: wall, side: shade(wall, -0.15) }) +
    box(-3, 0, 2, 3, HOME, HOME_H, shade(wall, -0.1), { top: shade(wall, -0.25), front: shade(wall, -0.3), side: shade(wall, -0.1) }) +
    onFront(HOME - 22, 0, 30, r(0, 0, 14, 12, light.isNight ? '#1c2754' : '#9fd3f5') + r(6.5, 0, 1, 12, '#5e3d22') + r(0, 0, 14, 12, 'none', 'stroke="#5e3d22" stroke-width="1.2"')) +
    onSide(0, 34, 30, r(0, 0, 14, 12, light.isNight ? '#1c2754' : '#9fd3f5') + r(0, 5.5, 14, 1, '#5e3d22') + r(0, 0, 14, 12, 'none', 'stroke="#5e3d22" stroke-width="1.2"')) +
    // a rug, a lamp in the corner, a picture
    poly([[14, 30, 2.1], [46, 30, 2.1], [46, 54, 2.1], [14, 54, 2.1]], ['#2a6f6b', '#8c3b2f', '#3d5a80'][k % 3] ?? '#2a6f6b', 'opacity=".6"') +
    box(4, 4, 2, 4, 4, 1, '#2b2d42') + box(5.5, 5.5, 3, 1, 1, 18, '#2b2d42') + box(3, 3, 21, 6, 6, 5, '#f6d7a7', { top: '#fff1cf' }) +
    onFront(10, 0, 28, r(0, 0, 12, 9, '#5e3d22') + r(1, 1, 10, 7, ['#e76f51', '#2a9d8f', '#f4d35e'][k % 3] ?? '#e76f51'))
  switch (pastime) {
    case 'sleep':
      s += sleeper(ch)
      break
    case 'sofa':
    case 'read': {
      // a sofa against the side wall, the owner on it with a hot drink; a TV across the room
      s += box(2, 18, 2, 12, 26, 6, '#b5523b') + box(2, 18, 8, 4, 26, 9, shade('#b5523b', -0.1)) + box(2, 16, 2, 12, 3, 11, '#a3462f') + box(2, 43, 2, 12, 3, 11, '#a3462f')
      s += at(...P(9, 32, 2), sitSprite(ch))
      if (pastime === 'sofa') {
        s += box(44, 24, 2, 4, 18, 14, '#1b1f2e') + box(44, 25, 6, 0.6, 16, 9, '#000', { side: '#4cc9f0' }) + onSide(44.6, 25, 15, r(0, 0, 16, 9, '#7fd8ff', 'class="tv"'))
      } else {
        s += box(20, 26, 2, 8, 8, 8, '#8b5e3c', { top: '#a8774d' }) + box(21, 27, 10, 5, 4, 1.4, '#e63946') + box(22, 31, 10, 3, 3, 3.5, '#f1f1f1', { top: '#6b3e26' })
      }
      break
    }
    case 'cook': {
      // a kitchen counter along the back wall, a pot steaming, the owner at the stove
      s += box(8, 2, 2, 44, 12, 14, '#e8e2d0', { top: '#5e3d22' }) + box(26, 4, 16, 8, 8, 5, '#3a3f4b') + box(40, 4, 16, 6, 6, 3, '#e63946')
      s += at(...P(30, 8, 22), `<g class="steam">${r(-1, -5, 0.9, 4, '#ffffffbb')}${r(1.5, -7, 0.9, 4, '#ffffffbb')}</g>`)
      s += at(...P(30, 22, 2), walkerSprite(ch, 'ny', 'stand'))
      break
    }
    case 'game': {
      // a gaming desk, the screen glowing, the owner at it
      s += at(...P(4, 4, 2), `<use href="#desk"/>` + working({ id: `home${k}`, character: charIndex, role: '', task: '', status: 'running', detail: '', joinedAt: 0, updatedAt: 0, tools: 0, active: 1 }, ch))
      break
    }
  }
  const [lx, ly] = P(HOME / 2, HOME / 2, HOME_H + 14)
  return { body: s, label: at(lx, ly, miniTag(`${ch.name}'s home`, ch.accent, PASTIME_LINE[pastime])) }
}

/**
 * Where everyone is when usage has run out: a little neighbourhood of homes,
 * one per agent, each doing something cozy, under a sign saying when they are
 * back, its bar filling up by itself until then.
 */
export function renderHomes(cast: number[], since: number, resetsAt: number | undefined, now: number, options: { theme?: Theme; hour?: number } = {}): { source: string; width: number; height: number } {
  const light = LIGHT[phaseOf(options.theme ?? 'auto', options.hour ?? 12)]
  const people = (cast.length ? cast : [0]).slice(0, 6)
  const cols = Math.min(3, people.length)
  const rows = Math.ceil(people.length / cols)
  const W = cols * PLOT
  const D = rows * PLOT
  let bodies = ''
  let labels = ''
  // back to front, so nearer homes are painted over farther ones
  const order = people.map((c, k) => ({ c, k, ox: (k % cols) * PLOT, oy: Math.floor(k / cols) * PLOT })).sort((a, b) => a.oy - b.oy || a.ox - b.ox)
  for (const { c, k, ox, oy } of order) {
    const h = home(c, k, light)
    const [sx, sy] = P(ox, oy, 0)
    bodies += at(sx, sy, h.body)
    labels += at(sx, sy, h.label)
  }
  const minX = -D - 24
  const maxX = W + 24
  const minY = -HOME_H - 70
  const maxY = (W + D) / 2 + 20
  const VW = maxX - minX
  const VH = maxY - minY
  // the sign: when everyone is back, and a bar that fills by itself until then
  const total = resetsAt ? Math.max(1, resetsAt - since) : 0
  const done = resetsAt ? Math.min(1, Math.max(0, (now - since) / total)) : 0
  const left = resetsAt ? Math.max(0, (resetsAt - now) / 1000) : 0
  const sw = Math.min(260, VW - 40)
  const sx0 = minX + (VW - sw) / 2
  const sy0 = minY + 8
  const sign =
    `<rect x="${f(sx0)}" y="${f(sy0)}" width="${f(sw)}" height="40" rx="6" fill="#121521" fill-opacity=".9" stroke="#cdb4ff" stroke-opacity=".6"/>` +
    `<text x="${f(sx0 + sw / 2)}" y="${f(sy0 + 13)}" font-size="8" font-weight="700" fill="#ffd166" text-anchor="middle">🏠 Out of usage · everyone went home</text>` +
    `<text x="${f(sx0 + sw / 2)}" y="${f(sy0 + 24)}" font-size="6" fill="#d5dae4" text-anchor="middle">${resetsAt ? `Back at ${esc(clockTime(resetsAt))}, when usage resets` : 'Back when usage resets'}</text>` +
    `<rect x="${f(sx0 + 12)}" y="${f(sy0 + 30)}" width="${f(sw - 24)}" height="4" rx="2" fill="#2b2d42"/>` +
    (resetsAt
      ? `<rect x="${f(sx0 + 12)}" y="${f(sy0 + 30)}" width="${f(sw - 24)}" height="4" rx="2" fill="#7ee081" style="transform-box:fill-box;transform-origin:0 50%;transform:scaleX(${done.toFixed(4)});animation:fill ${left.toFixed(0)}s linear 1 forwards"/>`
      : '')
  const css = `${CSS}@keyframes fill{to{transform:scaleX(1)}}.zz{animation:zz 3s ease-in-out infinite}@keyframes zz{0%{opacity:0;transform:translate(0,0)}30%{opacity:1}100%{opacity:0;transform:translate(6px,-12px)}}.tv{animation:tv 2.6s steps(3) infinite}@keyframes tv{33%{fill:#ffd166}66%{fill:#ff8fab}}`
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(minX)} ${f(minY)} ${f(VW)} ${f(VH)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0d0f16">` +
    `<style>${css}</style><defs>${DEFS}${cityDefs(light)}</defs>` +
    `<rect x="${f(minX)}" y="${f(minY)}" width="${f(VW)}" height="${f(VH)}" fill="url(#skybg)"/>` +
    skyLights(light, minX, minY, VW) +
    bodies +
    (light.tint ? `<rect x="${f(minX)}" y="${f(minY)}" width="${f(VW)}" height="${f(VH)}" fill="${light.tint[0]}" opacity="${light.tint[1]}" style="mix-blend-mode:multiply"/>` : '') +
    labels +
    sign +
    `</svg>`
  return { source, width: VW, height: VH }
}

export function describeHomes(cast: number[], resetsAt: number | undefined): string {
  const names = (cast.length ? cast : [0]).slice(0, 6).map(c => character(c).name)
  return `Out of usage: ${names.join(', ')} went home${resetsAt ? `, back at ${clockTime(resetsAt)}` : ''}.`
}
