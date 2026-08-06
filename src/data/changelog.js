// ==============================================
// changelog.js — the public release notes for MDKKU SAMO Portal.
//
// THIS FILE IS WRITTEN FOR READERS, NOT FOR US. `git log` is the engineering
// record and it stays the engineering record; this is the product record. Every
// entry answers "what changed for the person using the site", so a refactor
// that no one can see does not get an entry, and a one-line fix that unblocked
// a whole workflow does.
//
// HOW TO ADD A RELEASE
//   1. Run `npm run release` — it reads the commits since the last tag, proposes
//      the version bump, and writes the stub for you. Do not hand-edit the
//      number; `changelog.test.js` asserts the bump matches the level.
//   2. New object at the TOP of RELEASES (newest first — the page does not sort).
//   3. Write bullets a student could read. No table names, no migration numbers,
//      no permission keys. If a bullet needs a code identifier to make sense, it
//      belongs in git, not here.
//   4. `audience` decides which filter shows it — 'public' for anything a
//      visitor experiences, 'staff' for the admin workspace.
//   5. Run `npm test` — changelog.test.js checks the shape, the ordering and
//      that no entry leaks an identifier.
//
// The entries dated before 2026-07 are CONDENSED. Those three months ran at
// roughly thirteen commits per working day and shipping one entry per commit
// would produce a log nobody reads; they are grouped into the release that
// actually landed the capability.
// ==============================================

/**
 * VERSIONING — MAJOR.MINOR.PATCH. Full policy + workflow: docs/VERSIONING.md.
 *
 * Short form, because the definitions are what make the numbers mean anything:
 *
 *   MAJOR — the portal's SCOPE changed; it now does something categorically new
 *           (1.0.0 a PR form → 2.0.0 an operations platform → 3.0.0 faculty
 *           infrastructure with one account → 4.0.0 two-way with students)
 *   MINOR — a new feature or system inside the scope it already had
 *   PATCH — fixes and polish, nothing new to learn
 *
 * Classic SemVer defines MAJOR as "breaking change for integrators". A website
 * has no integrators, so that definition would never fire and every release
 * would be a MINOR forever. Redefining MAJOR against user-visible scope is the
 * standard adaptation for product software, and it is why the number moves at a
 * believable rate: four majors in the first three months, not nine.
 *
 * The tier drives the badge, the timeline node, and the accent treatment.
 * `patch` is unused so far — every release to date introduced something. That
 * is honest; the tier is here for the releases that will not.
 *
 * Labels stay in English on purpose. "รุ่นใหญ่ / รุ่นย่อย" is a literal
 * translation nobody says out loud; Thai developers say Major, Minor, เวอร์ชัน.
 */
export const LEVELS = {
  major: { label: 'Major', hint: 'ขอบเขตของระบบเปลี่ยนไป' },
  minor: { label: 'Minor', hint: 'ความสามารถใหม่' },
  patch: { label: 'Patch', hint: 'แก้ไขและปรับปรุง' },
};

/** The story of each MAJOR — what the portal became. Shown on the release. */
export const MAJOR_STORY = {
  '1.0.0': 'จุดเริ่มต้น — ฟอร์มออนไลน์ใบเดียว',
  '2.0.0': 'จากฟอร์ม สู่ระบบปฏิบัติการของสโมสร',
  '3.0.0': 'ย้ายมาอยู่บนโครงสร้างพื้นฐานของคณะ ใช้บัญชีเดียวทั้งระบบ',
  '4.0.0': 'สื่อสารสองทาง — นักศึกษาเห็นว่าปัญหาถูกแก้ถึงไหนแล้ว',
};

/**
 * The systems in this portal, in launch order — the spine of the landing-page
 * panel.
 *
 * This is the honest unit of progress for a NON-TECHNICAL reader. Commit counts,
 * lines changed and streak lengths measure effort, not result; they are
 * discredited even inside engineering (more code is a cost, not an
 * accomplishment) and to a SAMO member they read as either noise or grinding.
 *
 * ICONS: check a new one exists in the PINNED bootstrap-icons version
 * (1.10.5, see index.html) with `npm run check:icons`. A name added in a later
 * release renders as an empty box — silently, because a missing glyph is not an
 * error. Passport's own icon was exactly that; the plane also matches the
 * product's "Life is a Journey" identity, so it is not a consolation prize.
 *
 * DATES ARE LAUNCH DATES, not "when it joined this codebase". SAMO Passport
 * lives in its own repo (phuriphatma/samomdkkupassport, first commit
 * 2026-05-12) and was dated 2026-07-22 here at first — which is when its
 * DATABASE was merged into this project, an event no student experienced. If a
 * system's launch is not in this repo's git log, go and find it in the right
 * one; every other entry was verified against `git log --diff-filter=A` on the
 * module or migration that introduced it.
 *
 * Note what this does NOT claim. An earlier draft led with "100% built in-house,
 * no outside developers". That was dropped deliberately: this project is built
 * with AI assistance, and the claim overstated it. Saying what shipped and when
 * is true regardless of how it was built; a provenance boast is not.
 */
export const SYSTEMS = [
  { key: 'pr', label: 'ฟอร์มงาน PR', date: '2026-04-30', icon: 'bi-megaphone-fill', note: 'ฝากงาน PR ไม่ต้องทักแชท' },
  { key: 'news', label: 'ระบบประกาศ', date: '2026-05-02', icon: 'bi-newspaper', note: 'ทีมงานลงข่าวเองได้' },
  { key: 'vs', label: 'VitalSound', date: '2026-05-03', icon: 'bi-clipboard2-pulse-fill', note: 'ร้องเรียนแล้วตามเรื่องได้' },
  { key: 'passport', label: 'SAMO Passport', date: '2026-05-12', icon: 'bi-airplane-fill', note: 'สแกน QR สะสมกิจกรรมและแต้ม' },
  { key: 'shop', label: 'ร้านค้า SAMO', date: '2026-05-26', icon: 'bi-bag-heart-fill', note: 'สั่งของและจ่ายเงินออนไลน์' },
  { key: 'projects', label: 'หนังสือโครงการ', date: '2026-05-26', icon: 'bi-file-earmark-text-fill', note: 'ส่งเอกสารและลงนามในระบบ' },
  { key: 'team', label: 'ทีม SAMO', date: '2026-06-06', icon: 'bi-diagram-3-fill', note: 'ผังทีมที่คุมสิทธิ์เข้าระบบ' },
];

/** Change kinds. Order here is the order they render inside a release. */
export const CHANGE_TYPES = {
  new: { label: 'ใหม่', icon: 'bi-stars' },
  improved: { label: 'ปรับปรุง', icon: 'bi-arrow-up-circle' },
  fixed: { label: 'แก้ไข', icon: 'bi-wrench-adjustable' },
};

/** Product areas — the tag on each release. Icons only; no per-area colour,
 *  deliberately (ten tinted chips is a rainbow, and the change TYPE is the only
 *  thing on this page that earns colour). */
export const AREAS = {
  portal: { label: 'เว็บไซต์', icon: 'bi-globe2' },
  pr: { label: 'งาน PR', icon: 'bi-megaphone' },
  vs: { label: 'VitalSound', icon: 'bi-clipboard2-pulse' },
  news: { label: 'ประกาศ', icon: 'bi-newspaper' },
  shop: { label: 'ร้านค้า SAMO', icon: 'bi-bag' },
  projects: { label: 'หนังสือโครงการ', icon: 'bi-file-earmark-text' },
  team: { label: 'ทีม SAMO', icon: 'bi-diagram-3' },
  passport: { label: 'SAMO Passport', icon: 'bi-airplane' },
  account: { label: 'บัญชีผู้ใช้', icon: 'bi-person-badge' },
  platform: { label: 'ระบบพื้นฐาน', icon: 'bi-hdd-network' },
};

/**
 * PENDING — release notes staged as the work ships, before a version is cut.
 *
 * WHY THIS EXISTS. Release notes were written at release time, from `git log`,
 * weeks after the fact. That is the worst possible moment: the person writing
 * them has to reconstruct what a change MEANT to a student from a commit
 * message written for engineers, and the details that make a good note — what
 * was annoying before, what you no longer have to do — are exactly what has
 * been forgotten by then. So a user-visible change gets its note in the SAME
 * commit that ships it, while the reason is still obvious.
 *
 * Entries use the same shape as `changes` inside a release, and are held to the
 * same rules by changelog.test.js: plain Thai a student could read, no table
 * names, no migration numbers, no permission keys.
 *
 * NOT RENDERED. `/updates` shows released versions only — an unreleased list on
 * a public page is a promise, and this project has a standing rule against
 * promising cadence. `npm run release` folds these into the new version's stub
 * and empties the array.
 *
 * Add one when the change is something a person would NOTICE. A refactor, a
 * test, a migration nobody experiences: nothing. A fix that unblocked a real
 * workflow: yes, even if it was one line.
 */
export const PENDING = [
  { type: 'new', area: 'team', audience: 'staff',
    text: 'ทุกคนที่มีอีเมลอยู่ในทีม SAMO เปิดดูโครงสร้างทีมและสิทธิ์ของทุกคนได้แล้ว โดยยังแก้ไขไม่ได้ถ้าไม่ได้รับสิทธิ์แก้ไข' },
  { type: 'new', area: 'team', audience: 'public',
    text: 'การ์ด “ตำแหน่งของฉันในทีม SAMO” หน้าแรก แสดงรูป ชื่อเล่น รหัสนักศึกษา ชั้นปี และสาขา พร้อมบอกว่าข้อมูลส่วนไหนยังไม่ครบ' },
  { type: 'new', area: 'team', audience: 'public',
    text: 'แก้ไขข้อมูลของตัวเองได้จากหน้าแรก ไม่ต้องรอผู้ดูแลทีมแก้ให้' },
  { type: 'improved', area: 'team', audience: 'staff',
    text: 'กดที่ชื่อคนหรือตำแหน่งแล้วแก้ได้ทั้งข้อมูลและสิทธิ์ในหน้าต่างเดียว ไม่ต้องย้อนกลับไปค้นหาคนเดิมอีกรอบ' },
  { type: 'fixed', area: 'account', audience: 'public',
    text: 'หน้าแรกไม่ขึ้น “ยังไม่ได้ระบุฝ่าย” กับคนที่มีตำแหน่งในทีม SAMO อยู่แล้ว' },
  { type: 'fixed', area: 'portal', audience: 'public',
    text: 'กดเปลี่ยนหน้าแล้วเริ่มที่ด้านบนของหน้าใหม่เสมอ จากเดิมที่ค้างอยู่ตำแหน่งเดิมของหน้าก่อน เช่น กด “ดูอัปเดตทั้งหมด” แล้วไปโผล่กลางรายการ' },
  { type: 'improved', area: 'team', audience: 'public',
    text: 'ปุ่มบนการ์ดตำแหน่งของฉัน พาไปที่หน้าทีม SAMO โดยตรง ไม่ต้องกดเลือกเมนูอีกครั้ง' },
  { type: 'fixed', area: 'team', audience: 'staff',
    text: 'หน้าต่างกำหนดสิทธิ์เคยค้างค่าจากคนที่เปิดดูก่อนหน้า ทำให้เห็นสิทธิ์ผิดคน ตอนนี้เริ่มใหม่ทุกครั้งที่เปิด' },
  { type: 'fixed', area: 'team', audience: 'staff',
    text: 'หน้าต่างแก้ไขสมาชิกเลื่อนดูข้อมูลด้านล่างได้แล้ว จากเดิมที่เนื้อหาถูกตัดและเลื่อนไม่ได้' },
  { type: 'fixed', area: 'team', audience: 'public',
    text: 'อีเมล KKU บนการ์ดตำแหน่งของฉันแสดงเต็มบรรทัด ไม่ถูกตัดกลางคำ และปุ่มแก้ไขอยู่ติดกับข้อมูลที่จะแก้ หน้าจึงไม่กระโดด' },
  { type: 'improved', area: 'team', audience: 'public',
    text: 'ถ้ารหัสนักศึกษาของคุณไปซ้ำกับคนอื่น หน้าแรกจะแจ้งให้ทราบพร้อมบอกว่าต้องทำอย่างไร จากเดิมที่เห็นได้เฉพาะผู้ดูแลทีม' },
  { type: 'fixed', area: 'account', audience: 'staff',
    text: 'ทุกคนที่มีตำแหน่งในทีม SAMO เห็นเมนู “ไปยัง Admin Dashboard” ตอนกดที่ชื่อบัญชีมุมขวาบนแล้ว จากเดิมที่ต้องพิมพ์ที่อยู่หน้าเว็บเอง' },
  { type: 'new', area: 'team', audience: 'public',
    text: 'เปลี่ยนรูปประจำตัวของตัวเองได้จากการ์ดตำแหน่งของฉัน ปรับกรอบรูปเองได้ก่อนบันทึก' },
  { type: 'new', area: 'team', audience: 'public',
    text: 'แก้ชื่อ-สกุลของตัวเองได้ด้วย และข้อมูลที่แก้จะไปอยู่ในทุกตำแหน่งที่คุณมีในผังทีม' },
  { type: 'new', area: 'team', audience: 'staff',
    text: 'แก้ข้อมูลของตัวเองได้จากในหน้าทีม SAMO เลย หัวข้อ “ข้อมูลของฉัน” ไม่ต้องกลับไปหน้าแรก' },
  { type: 'improved', area: 'team', audience: 'public',
    text: 'ชั้นปีและสาขาเปลี่ยนเป็นแบบเลือกจากรายการ จากเดิมที่พิมพ์เองแล้วได้คนละแบบ เช่น ปี5 กับ 5 หรือ md กับ MD' },
  { type: 'improved', area: 'team', audience: 'staff',
    text: 'เพิ่ม แก้ชื่อ หรือเอาสาขาออกจากรายการได้เอง พร้อมบอกว่ามีสมาชิกกี่คนที่ใช้สาขานั้นก่อนกดยืนยัน' },
  { type: 'improved', area: 'team', audience: 'public',
    text: 'รหัสนักศึกษาบอกรูปแบบที่ถูกต้องไว้ให้ พิมพ์ติดกัน 10 หลักก็ได้ ระบบเติมขีดให้เอง และไม่รับค่าที่อ่านไม่ออก' },
  { type: 'improved', area: 'team', audience: 'public',
    text: 'การ์ดตำแหน่งของฉันแสดงสายงานเต็มจนถึงตำแหน่งของคุณ เช่น ฝ่ายดิจิทัลและสื่อสารองค์กร › ฝ่าย IT › หัวหน้าฝ่าย IT' },
  { type: 'improved', area: 'team', audience: 'staff',
    text: 'เอาช่องคำนำหน้าออกจากข้อมูลสมาชิก เพราะไม่ได้ใช้แสดงที่ไหน และทำให้หน้าตรวจสอบข้อมูลขึ้นเตือนโดยไม่จำเป็น' },
  { type: 'fixed', area: 'team', audience: 'staff',
    text: 'เปลี่ยนรูปสมาชิกแล้วไม่มีไฟล์ค้างซ้อนกันอีก รูปจะถูกอัปโหลดตอนกดบันทึกเท่านั้น ปิดหน้าต่างทิ้งจึงไม่เหลือไฟล์ที่ไม่ได้ใช้' },
  { type: 'fixed', area: 'team', audience: 'staff',
    text: 'ตัวเลือก “ทุกระบบ (Master)” ไม่ขึ้นสีเหมือนถูกเลือกไว้แล้ว ตอนนี้ดูออกชัดว่าเลือกอยู่หรือไม่' },
  { type: 'fixed', area: 'team', audience: 'staff',
    text: 'ช่อง “ทีม SAMO (ดู)” ในหน้ากำหนดสิทธิ์กดเอาเครื่องหมายถูกออกไม่ได้อีกแล้ว เพราะทุกคนที่มีตำแหน่งได้สิทธิ์นี้อยู่แล้ว จากเดิมที่กดออกได้แต่ไม่มีผลจริง' },
  { type: 'improved', area: 'team', audience: 'staff',
    text: 'สิทธิ์ดูทีม SAMO ขึ้นเป็นติ๊กถาวรพร้อมบอกว่าได้อัตโนมัติ เพราะทุกคนที่มีอีเมลอยู่ในผังทีมได้สิทธิ์นี้อยู่แล้ว ปิดไม่ได้' },
  { type: 'improved', area: 'team', audience: 'public',
    text: 'ข้อความแจ้งเตือนบอกให้ติดต่ออุปนายกฝ่ายของท่าน หรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO แทนคำว่า “ผู้ดูแล” ที่ไม่รู้ว่าเป็นใคร' },
];

export const RELEASES = [
  {
    version: '4.4.0',
    level: 'minor',
    date: '2026-08-01',
    title: 'รูปประจำตัวทีม และการตรวจสอบข้อมูลรายชื่อ',
    summary:
      'ปิดงานชุดใหญ่ของทีม SAMO — ปรับกรอบรูปได้เองก่อนอัปโหลด และมีหน้าตรวจสอบ'
      + 'ที่บอกว่ารายชื่อคนไหนข้อมูลยังไม่ครบ พร้อมกดไปแก้ได้ทันที',
    areas: ['team'],
    audience: 'staff',
    changes: [
      { type: 'new', text: 'เลือกรูปประจำตัวแล้วปรับกรอบ (ซูม/เลื่อน) ได้ในตัว รูปที่อัปโหลดจะพอดีกับการ์ดในผังองค์กรเสมอ' },
      { type: 'new', text: 'หน้า “ตรวจสอบข้อมูล” รวมทุกจุดที่รายชื่อขัดแย้งกันเอง เช่น ชื่อเล่นคนเดียวกันสะกดไม่ตรงกันในสองฝ่าย' },
      { type: 'new', text: 'ในหน้าจัดการทีม จะมีสัญลักษณ์เตือนบนแถวของคนที่ต้องตรวจสอบ และตัวเลขรวมบนฝ่ายต้นสังกัด กดแล้วเปิดหน้าตรวจสอบที่กรองมาให้เฉพาะคนนั้น' },
      { type: 'improved', text: 'รูปที่ถูกลบหรือถูกแทนที่จะถูกเก็บกวาดออกจาก Drive จริง แต่จะไม่ลบถ้ายังมีปีการศึกษาเก่าใช้รูปนั้นอยู่' },
      { type: 'fixed', text: 'หน้าต่างเลือกตำแหน่งเคยเปิดไปซ่อนอยู่ใต้หน้าต่างแก้ไขสมาชิก ตอนนี้ซ้อนขึ้นมาถูกลำดับแล้ว' },
    ],
  },
  {
    version: '4.3.0',
    level: 'minor',
    date: '2026-07-30',
    title: 'ผังองค์กรสาธารณะ พร้อมรูปคณะกรรมการ และปีการศึกษาย้อนหลัง',
    summary:
      'หน้า “เกี่ยวกับเรา” แสดงโครงสร้างองค์กรจริงทั้งผัง พร้อมกริดรูปคณะกรรมการ '
      + 'และเลือกดูย้อนหลังได้ทีละปีการศึกษา',
    areas: ['portal', 'team'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'ผังองค์กร ทีม SAMO เปิดให้บุคคลทั่วไปดูได้ — ค้นหาชื่อ ชื่อเล่น หรือตำแหน่งได้ทันที' },
      { type: 'new', text: 'กริดรูปคณะกรรมการด้านบนสุดของผัง เรียงตามลำดับในองค์กร' },
      { type: 'new', text: 'ทุกปีการศึกษาถูกเก็บเป็นภาพนิ่งของตัวเอง เลือกดูปีเก่าได้โดยไม่กระทบผังปีปัจจุบัน' },
      { type: 'improved', text: 'รวมผังองค์กรเข้าไปอยู่ในแท็บ “เกี่ยวกับเรา” แทนที่จะแยกเป็นอีกแท็บ' },
      { type: 'improved', text: 'เผยแพร่เฉพาะชื่อ ชื่อเล่น ตำแหน่ง และรูปเท่านั้น ข้อมูลอื่นของสมาชิกไม่ออกจากระบบหลังบ้าน' },
    ],
  },
  {
    version: '4.2.0',
    level: 'minor',
    date: '2026-07-29',
    title: 'VitalSound — เลือกได้ว่าบันทึกไหนให้ใครเห็น',
    summary:
      'บันทึกข้อความในเรื่องร้องเรียนแยกระดับการมองเห็นชัดเจน ระหว่างเจ้าหน้าที่กันเอง '
      + 'ผู้แจ้ง และสาธารณะ',
    areas: ['vs'],
    audience: 'staff',
    changes: [
      { type: 'new', text: 'บันทึกข้อความเลือกได้ว่าให้เห็นเฉพาะเจ้าหน้าที่ ให้ผู้แจ้งเห็นด้วย หรือแสดงบนกระดานปัญหาสาธารณะ' },
      { type: 'new', text: 'ความคืบหน้าที่เลือกเผยแพร่จะไหลไปขึ้นบนกระดานปัญหาให้ทุกคนติดตามได้' },
      { type: 'new', text: 'ลบหมวดหมู่ที่เลิกใช้ได้แล้ว และเรื่องที่ยังอ้างหมวดหมู่นั้นจะถูกถือว่าเป็นความลับไว้ก่อนเสมอ' },
      { type: 'improved', text: 'ถ้าเรื่องของคุณถูกรวมเข้ากับเรื่องหลักที่ขึ้นกระดานสาธารณะแล้ว ระบบจะบอกให้ทราบ' },
    ],
  },
  {
    version: '4.1.0',
    level: 'minor',
    date: '2026-07-25',
    title: 'ผังทีม SAMO กลายเป็นระบบสิทธิ์จริง',
    summary:
      'เพิ่มคนเข้าตำแหน่งในผังทีม แล้วเขาเข้าสู่ระบบด้วย KKU Mail ได้สิทธิ์ตามตำแหน่งนั้นทันที '
      + 'ไม่ต้องสร้างบัญชีกลางร่วมกันอีก',
    areas: ['team', 'account'],
    audience: 'staff',
    changes: [
      { type: 'new', text: 'สิทธิ์การใช้งานระบบผูกกับตำแหน่งในผังทีม และสืบทอดลงไปยังตำแหน่งย่อยได้' },
      { type: 'new', text: 'กำหนดสิทธิ์รายบุคคลเพิ่มจากสิทธิ์ของตำแหน่งได้' },
      { type: 'new', text: 'VitalSound มอบสิทธิ์แบบเจาะจงฝ่ายได้ — เห็นและจัดการเฉพาะเรื่องของฝ่ายตัวเอง' },
      { type: 'new', text: 'หนังสือโครงการแยกบทบาทชัดเจน: ผู้ส่ง เจ้าหน้าที่คณะ และอาจารย์ผู้ลงนาม' },
      { type: 'new', text: 'SAMO Passport มอบสิทธิ์ผู้ดูแลแบบเจาะจงฝ่ายได้เช่นกัน' },
      { type: 'improved', text: 'เข้าสู่ระบบด้วย KKU Mail ส่วนตัวได้ แทนการใช้บัญชีกลางของฝ่ายร่วมกัน' },
    ],
  },
  {
    version: '4.0.0',
    level: 'major',
    date: '2026-07-24',
    title: 'กระดานปัญหาสาธารณะ ของ VitalSound',
    summary:
      'เรื่องที่ร้องเรียนเข้ามาไม่หายเข้ากล่องดำอีกต่อไป — เรื่องที่เจ้าหน้าที่เลือกเผยแพร่ '
      + 'จะขึ้นกระดานให้ทุกคนเห็น กด “เจอเหมือนกัน” และติดตามความคืบหน้าได้',
    areas: ['vs'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'กระดานปัญหา — ดูปัญหาที่กำลังแก้อยู่ กด “เจอเหมือนกัน” เพื่อบอกว่าคุณเจอปัญหาเดียวกัน และแสดงความเห็นได้' },
      { type: 'new', text: 'ผู้แจ้งเลือกเองได้ว่าจะยินยอมให้เรื่องของตัวเองขึ้นกระดานสาธารณะหรือไม่' },
      { type: 'new', text: 'เรื่องซ้ำถูกรวมเป็นกลุ่มเดียวกัน ผู้แจ้งทุกคนในกลุ่มเห็นความคืบหน้าเดียวกัน แทนที่จะถูกปิดเรื่องเงียบ ๆ' },
      { type: 'new', text: 'ปิดเรื่องต้องระบุเหตุผลของผลลัพธ์ ผู้แจ้งจึงรู้ว่าเรื่องจบอย่างไร' },
      { type: 'improved', text: 'เจ้าหน้าที่มีมุมมองแบบผังเรื่องซ้ำ ค้นหาเรื่อง และจัดการหมวดหมู่ได้ในหน้าเดียว' },
    ],
  },
  {
    version: '3.1.0',
    level: 'minor',
    date: '2026-07-23',
    title: 'สถิติการใช้งานจริง บนหน้าแรก',
    summary:
      'หน้าแรกแสดงตัวเลขการใช้งานจริงของระบบ และทีมงานมีหน้าสถิติเชิงลึกของตัวเอง '
      + 'โดยไม่เก็บคุกกี้ติดตามผู้ใช้',
    areas: ['portal'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'แถบ “SAMO Portal ในตัวเลข” บนหน้าแรก — สมาชิก ฝ่ายที่ใช้งาน และอัตราการปิดงาน PR / VitalSound / หนังสือโครงการ' },
      { type: 'new', text: 'หน้าสถิติการใช้งานสำหรับทีมงาน พร้อมกราฟรายวัน' },
      { type: 'improved', text: 'การเก็บสถิติเป็นแบบไม่ใช้คุกกี้ และไม่ผูกกับตัวบุคคล' },
    ],
  },
  {
    version: '3.0.0',
    level: 'major',
    date: '2026-07-22',
    title: 'ย้ายมาอยู่บนโดเมนของคณะ และรวม SAMO Passport เข้าระบบเดียว',
    summary:
      'เว็บทั้งหมดย้ายมาอยู่ที่ samo.md.kku.ac.th บนเซิร์ฟเวอร์ของมหาวิทยาลัย '
      + 'และ SAMO Passport ย้ายมาใช้ระบบบัญชีเดียวกับพอร์ทัล',
    areas: ['platform', 'passport'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'เว็บไซต์ให้บริการที่ samo.md.kku.ac.th — ที่อยู่เดิมจะพาไปยังที่อยู่ใหม่ให้อัตโนมัติ' },
      { type: 'new', text: 'SAMO Passport ใช้บัญชีเดียวกับพอร์ทัล และเข้าถึงได้จากที่อยู่เดียวกัน' },
      { type: 'improved', text: 'ร้านค้ารองรับ PromptPay แยกตามบัญชีของแต่ละฝ่าย และเลือกจุดรับของได้' },
      { type: 'improved', text: 'หนังสือโครงการกรองตามปีงบประมาณได้' },
      { type: 'fixed', text: 'ผู้ที่เคยใช้ Passport ด้วยอีเมลส่วนตัว ถูกย้ายข้อมูลมาที่ KKU Mail ครบถ้วน' },
    ],
  },
  {
    version: '2.8.0',
    level: 'minor',
    date: '2026-06-13',
    title: 'ขอความยินยอมก่อนส่งเรื่อง VitalSound',
    summary: 'เพิ่มการแจ้งและขอความยินยอมตาม PDPA ทุกครั้งก่อนส่งเรื่องร้องเรียน',
    areas: ['vs'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'หน้าต่างขอความยินยอมตาม PDPA แสดงทุกครั้งก่อนส่งเรื่อง พร้อมบอกว่าใครจะเห็นข้อมูลบ้าง' },
      { type: 'new', text: 'เพิ่มลิงก์คลังข้อสอบ MDKKU Self Exam Bank ในหน้าฝ่ายวิชาการ' },
      { type: 'improved', text: 'ปุ่มเข้าสู่ระบบและออกจากระบบบนแถบบนสุดของมือถือ' },
    ],
  },
  {
    version: '2.7.0',
    level: 'minor',
    date: '2026-06-10',
    title: 'อาจารย์ลงนามหนังสือโครงการได้ในระบบ',
    summary:
      'ปิดวงจรของหนังสือโครงการ — ส่ง รับเรื่อง แล้วอาจารย์ลงนามได้ในระบบ '
      + 'พร้อมบันทึกเวลาทุกการกระทำ',
    areas: ['projects'],
    audience: 'staff',
    changes: [
      { type: 'new', text: 'อาจารย์เข้าระบบเพื่อลงนามหนังสือได้ เห็นเฉพาะหนังสือที่ส่งมาให้ลงนาม' },
      { type: 'new', text: 'ลงนามแบบหลายหน้าได้ และดูสถานะการลงนามรายไฟล์ในที่เดียวกับไฟล์แนบ' },
      { type: 'new', text: 'บันทึกเวลาทุกการลงนาม การส่งกลับ และความเห็น ไว้ในประวัติของหนังสือ' },
      { type: 'new', text: 'ประกาศปักหมุดเรื่องเด่นได้ และหน้าจัดการประกาศเปลี่ยนเป็นการ์ดพร้อมตัวแก้ไขแบบป๊อปอัป' },
    ],
  },
  {
    version: '2.6.0',
    level: 'minor',
    date: '2026-06-06',
    title: 'ผังทีม SAMO และการกู้คืนเรื่องที่ลบ',
    summary:
      'เครื่องมือจัดการโครงสร้างองค์กรของสโมสร แก้ไขพร้อมกันหลายคนได้ '
      + 'และเรื่องที่ลบไปแล้วกู้กลับมาได้',
    areas: ['team', 'pr', 'vs'],
    audience: 'staff',
    changes: [
      { type: 'new', text: 'ผังทีม SAMO — เพิ่ม ย้าย และจัดลำดับฝ่าย/ตำแหน่ง/สมาชิก ด้วยการลากวาง' },
      { type: 'new', text: 'นำเข้าและส่งออกรายชื่อเป็น JSON หรือ CSV พร้อมตัวช่วยตัดสินใจเมื่อพบข้อมูลซ้ำทีละรายการ' },
      { type: 'new', text: 'แก้ไขพร้อมกันหลายคนแล้วเห็นการเปลี่ยนแปลงของกันและกันแบบสด' },
      { type: 'new', text: 'เรื่อง PR และ VitalSound ที่ลบไปแล้วสามารถกู้คืนได้' },
      { type: 'improved', text: 'เลือกหลายรายการเพื่อย้ายหรือลบพร้อมกัน และค้นหาตำแหน่งปลายทางได้' },
    ],
  },
  {
    version: '2.5.0',
    level: 'minor',
    date: '2026-06-03',
    title: 'หน้าฝ่าย และการติดตามหนังสือโครงการแบบเปิด',
    summary:
      'เพิ่มหน้ารวมฝ่ายทั้ง 10 ฝ่าย และเปิดให้ผู้จัดทำโครงการติดตามสถานะหนังสือของตัวเองได้ '
      + 'โดยไม่ต้องเข้าสู่ระบบ',
    areas: ['portal', 'projects', 'shop'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'หน้า “ฝ่าย” รวมทุกฝ่ายพร้อมสีและแหล่งข้อมูลประจำฝ่าย' },
      { type: 'new', text: 'ผู้จัดทำโครงการติดตามสถานะหนังสือของตัวเองได้จากลิงก์ที่ได้รับ' },
      { type: 'new', text: 'ร้านค้า: แบนเนอร์เลื่อนได้บนหน้าประกาศ ระบุเบอร์ติดต่อ และแนบสลิปได้หลายใบ' },
      { type: 'new', text: 'ร้านค้า (ทีมงาน): แก้ไขคำสั่งซื้อ ติดตามสถานะรายชิ้น หน้าสรุปยอดพรีออเดอร์ และส่งออก CSV' },
      { type: 'improved', text: 'เพิ่มคอลัมน์แหล่งข้อมูลในส่วนท้ายเว็บ — คลังข้อมูลวิชาการ SAMO, เว็บไซต์ MDI และ RT' },
    ],
  },
  {
    version: '2.4.0',
    level: 'minor',
    date: '2026-05-31',
    title: 'สลับบัญชีได้ทันที และยกเครื่องหน้าหนังสือโครงการ',
    summary:
      'ผู้ที่ดูแลหลายบัญชีสลับไปมาได้ในคลิกเดียวแบบเดียวกับ Google '
      + 'และหน้าหนังสือโครงการถูกออกแบบใหม่ทั้งหมด',
    areas: ['account', 'projects', 'shop'],
    audience: 'staff',
    changes: [
      { type: 'new', text: 'สลับบัญชีที่เคยเข้าสู่ระบบไว้ได้ทันที ไม่ต้องกรอกรหัสผ่านซ้ำ' },
      { type: 'new', text: 'ความเห็นในหนังสือโครงการ แก้ไขและลบได้ พร้อมไฮไลต์สิ่งที่ยังไม่ได้อ่าน' },
      { type: 'new', text: 'QR ประจำโครงการ เปิดไปยังโฟลเดอร์เอกสารของโครงการนั้นได้ทันที' },
      { type: 'new', text: 'ร้านค้า: โหมดพรีออเดอร์ที่แยกราคาและไม่จำกัดจำนวน พร้อมตัดสต็อกแบบกันซื้อชนกัน' },
      { type: 'improved', text: 'สถานะ “อ่านแล้ว” ของหนังสือโครงการตรงกันทุกอุปกรณ์ของผู้ใช้คนเดียวกัน' },
      { type: 'fixed', text: 'เมื่อมีเวอร์ชันใหม่ของเว็บ แท็บที่เปิดค้างไว้จะโหลดตัวเองใหม่แทนที่จะค้างอยู่กับของเก่า' },
    ],
  },
  {
    version: '2.3.0',
    level: 'minor',
    date: '2026-05-30',
    title: 'QR คำสั่งซื้อ และการจัดการบัญชีของตัวเอง',
    areas: ['shop', 'account'],
    audience: 'public',
    summary: 'รับของหน้าร้านด้วย QR และผู้ใช้แก้ไขข้อมูลบัญชีของตัวเองได้',
    changes: [
      { type: 'new', text: 'ทุกคำสั่งซื้อมี QR ให้ทีมงานสแกนตอนรับของ' },
      { type: 'new', text: 'แก้ไขชื่อ ตั้งรหัสผ่าน และเชื่อมบัญชี Google ได้เองในหน้าจัดการบัญชี' },
      { type: 'new', text: 'รหัสคำสั่งซื้อใช้รูปแบบตามสินค้า อ่านแล้วรู้ทันทีว่าเป็นสินค้าอะไร' },
      { type: 'improved', text: 'สินค้าที่หมดจะกดสั่งไม่ได้ และแสดงสต็อกแยกตามไซซ์และสี' },
    ],
  },
  {
    version: '2.2.0',
    level: 'minor',
    date: '2026-05-29',
    title: 'จองห้องสโม และเครื่องมือจัดหน้าประกาศ',
    areas: ['portal', 'news', 'shop'],
    audience: 'public',
    summary: 'เพิ่มระบบจองห้องสโม ลิงก์ SAMO Passport และเครื่องมือจัดรูปหน้าประกาศ',
    changes: [
      { type: 'new', text: 'ระบบจองห้องสโม และลิงก์ไปยัง SAMO Passport' },
      { type: 'new', text: 'ตัวครอบรูปสัดส่วน 16:9 สำหรับรูปปกประกาศ' },
      { type: 'new', text: 'จัดลำดับประกาศด้วยการลากวาง และแบนเนอร์หน้าร้านที่ทีมงานอัปโหลดเองได้' },
      { type: 'fixed', text: 'แก้ปัญหาปุ่มออกจากระบบบนมือถือ' },
    ],
  },
  {
    version: '2.1.0',
    level: 'minor',
    date: '2026-05-28',
    title: 'VitalSound แบบคัดแยกงาน และบัญชีอุปนายกรายฝ่าย',
    areas: ['vs', 'account'],
    audience: 'staff',
    summary:
      'เจ้าหน้าที่เห็นเรื่องทั้งหมดเป็นบอร์ดคัดแยกตามสถานะ และอุปนายกแต่ละฝ่าย'
      + 'มีบัญชีของตัวเองที่เห็นเฉพาะเรื่องของฝ่ายตน',
    changes: [
      { type: 'new', text: 'บอร์ดคัดแยกเรื่อง VitalSound แยกตามสถานะ พร้อมป้ายบอกอายุของเรื่อง' },
      { type: 'new', text: 'บัญชีอุปนายกรายฝ่าย เห็นและจัดการเฉพาะเรื่องที่ส่งถึงฝ่ายของตนเอง' },
      { type: 'new', text: 'ระบบสิทธิ์การใช้งานแยกตามเครื่องมือ แทนการให้สิทธิ์ทั้งหมดหรือไม่ให้เลย' },
      { type: 'improved', text: 'ที่อยู่เว็บ (URL) เปลี่ยนตามหน้าที่เปิดอยู่ ทำให้บันทึกและแชร์ลิงก์ได้ตรงหน้า' },
    ],
  },
  {
    version: '2.0.0',
    level: 'major',
    date: '2026-05-26',
    title: 'เปิดตัวร้านค้า SAMO และระบบหนังสือโครงการ',
    summary:
      'สองระบบใหญ่เปิดพร้อมกัน — ร้านค้าออนไลน์ของสโมสร '
      + 'และระบบส่งหนังสือโครงการระหว่างสโมสรกับคณะ',
    areas: ['shop', 'projects'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'ร้านค้า SAMO — เลือกสินค้า ไซซ์ สี ใส่ตะกร้า และแนบสลิปการโอน' },
      { type: 'new', text: 'ระบบหนังสือโครงการ — ส่งหนังสือถึงเจ้าหน้าที่คณะ ติดตามสถานะ และรับเรื่องกลับ' },
      { type: 'new', text: 'ไฟล์แนบทุกอย่างถูกจัดเก็บเข้าโฟลเดอร์อัตโนมัติตามโครงการ' },
      { type: 'new', text: 'แจ้งเตือนไปยัง Discord และอีเมลของฝ่ายที่เกี่ยวข้อง' },
    ],
  },
  {
    version: '1.5.0',
    level: 'minor',
    date: '2026-05-25',
    title: 'ดีไซน์ใหม่ทั้งเว็บ',
    summary: 'ปรับอัตลักษณ์ทั้งไซต์ — ฟอนต์ไทยเต็มระบบ สีประจำฝ่าย และโครงหน้าใหม่',
    areas: ['portal'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'ใช้ฟอนต์ Noto Sans Thai ทั้งเว็บ อ่านภาษาไทยได้สบายตาขึ้นมาก' },
      { type: 'new', text: 'สีประจำฝ่ายทั้ง 10 ฝ่าย ใช้ต่อเนื่องกันทุกหน้า' },
      { type: 'new', text: 'หน้า “เกี่ยวกับเรา” พร้อมวิสัยทัศน์ พันธกิจ และนโยบาย' },
      { type: 'improved', text: 'เมนูบนสุดจัดกลุ่มใหม่ และใช้งานบนมือถือได้ดีขึ้น' },
    ],
  },
  {
    version: '1.4.0',
    level: 'minor',
    date: '2026-05-22',
    title: 'ย้ายฐานข้อมูลทั้งระบบ',
    summary:
      'ย้ายข้อมูลทั้งหมดจาก Google Sheet มาอยู่บนฐานข้อมูลจริง '
      + 'ผลคือทุกหน้าโหลดเร็วขึ้นอย่างชัดเจนและข้อมูลไม่ชนกันเมื่อใช้พร้อมกันหลายคน',
    areas: ['platform'],
    audience: 'public',
    changes: [
      { type: 'improved', text: 'ทุกหน้าโหลดเร็วขึ้นมาก หลังย้ายจากสเปรดชีตมาเป็นฐานข้อมูลจริง' },
      { type: 'improved', text: 'ใช้งานพร้อมกันหลายคนได้โดยข้อมูลไม่ทับกัน' },
      { type: 'new', text: 'ระบบบัญชีเดียวใช้ได้ทั้ง PR และ VitalSound' },
      { type: 'new', text: 'กำหนดสิทธิ์การเข้าถึงข้อมูลในระดับฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่มในหน้าเว็บ' },
    ],
  },
  {
    version: '1.3.0',
    level: 'minor',
    date: '2026-05-21',
    title: 'หน้าทำงานสำหรับทีมงาน',
    summary: 'รวมเครื่องมือของทีมงานไว้ในหน้าทำงานเดียว พร้อมบอร์ดติดตามงาน',
    areas: ['pr', 'vs'],
    audience: 'staff',
    changes: [
      { type: 'new', text: 'หน้าทำงานสำหรับทีมงาน รวมงาน PR และ VitalSound ไว้ที่เดียว' },
      { type: 'new', text: 'บอร์ดติดตามงานแบบคัดแยกตามสถานะ' },
      { type: 'new', text: 'ตัวกรองตามฝ่ายในหน้างาน PR' },
    ],
  },
  {
    version: '1.2.0',
    level: 'minor',
    date: '2026-05-03',
    title: 'เปิดตัว VitalSound และเข้าสู่ระบบด้วย Google',
    summary:
      'ช่องทางร้องเรียนและข้อเสนอแนะถึงสโมสรอย่างเป็นทางการ '
      + 'พร้อมการติดตามสถานะด้วยรหัสเรื่อง',
    areas: ['vs', 'account'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'VitalSound — ส่งเรื่องร้องเรียนหรือข้อเสนอแนะถึงสโมสรได้โดยตรง' },
      { type: 'new', text: 'ติดตามสถานะเรื่องของตัวเองด้วยรหัสเรื่องที่ได้รับ' },
      { type: 'new', text: 'เข้าสู่ระบบด้วยบัญชี Google และดูประวัติการส่งเรื่องทั้งหมดของตัวเอง' },
      { type: 'new', text: 'ส่งเรื่องถึงอุปนายกฝ่ายที่รับผิดชอบโดยตรง' },
    ],
  },
  {
    version: '1.1.0',
    level: 'minor',
    date: '2026-05-02',
    title: 'ระบบประกาศ',
    summary: 'ทีมงานเขียนและเผยแพร่ประกาศได้เองบนเว็บ',
    areas: ['news'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'หน้าประกาศและข่าวสาร' },
      { type: 'new', text: 'ทีมงานเขียน แก้ไข และเผยแพร่ประกาศได้เองด้วยตัวแก้ไขข้อความ' },
    ],
  },
  {
    version: '1.0.0',
    level: 'major',
    date: '2026-04-30',
    title: 'เปิดตัว MDKKU SAMO Portal',
    summary:
      'จุดเริ่มต้นของทุกอย่าง — แบบฟอร์มฝากงานประชาสัมพันธ์ออนไลน์ '
      + 'แทนการทักแชทและตามงานกันเอง',
    areas: ['pr'],
    audience: 'public',
    changes: [
      { type: 'new', text: 'แบบฟอร์มฝากงาน PR ออนไลน์ พร้อมแนบไฟล์และกำหนดวันที่ต้องการเผยแพร่' },
      { type: 'new', text: 'แจ้งเตือนทีม PR อัตโนมัติเมื่อมีงานเข้าใหม่' },
    ],
  },
];

/** Newest release — the version badge in the footer and the home panel use it. */
export const LATEST = RELEASES[0];

/** Count of everything shipped, for the ฝ่าย IT panel. */
export function changeCounts() {
  const out = { new: 0, improved: 0, fixed: 0, total: 0 };
  for (const r of RELEASES) {
    for (const c of r.changes) {
      if (out[c.type] !== undefined) out[c.type] += 1;
      out.total += 1;
    }
  }
  return out;
}
