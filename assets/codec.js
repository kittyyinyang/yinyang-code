/**
 * 阴阳人格 · 核心编码器 v1（2026-09-24）
 * ============================================================
 * 把「阴阳」编译成 0/1，让下游（AI / 网站 / 小程序 / 检索）只做位运算，
 * 不再在自然语言层做语义匹配（那正是"在相上打转"的根因）。
 *
 * 【唯一语义锚点】
 *   1（阳）= 价值感自己给的
 *   0（阴）= 价值感要别人给的
 * 除这一条外，编码器不持有任何"阴阳含义"。所有语义解释由上层文档负责。
 *
 * 【位序】自下而上。3bit 人格卦：bit0=初爻(能量) bit1=二爻(性别) bit2=三爻(外显)
 *        6bit 重卦：低3位=下卦(我) 高3位=上卦(场)
 * ============================================================
 * 用法：node _tools/yinyang_codec.js        （自检 + 打印全表）
 *       require('./yinyang_codec.js')       （模块）
 */

// ---------- L1：八卦（3bit，码 0–7 = 莱布尼茨/先天二进制序）----------
// bits = [初爻能量, 二爻性别(1男/0女), 三爻外显]（自下而上）
// code = 初爻*1 + 二爻*2 + 三爻*4（标准莱布尼茨/先天二进制序）
const GUA = [
  { code: 0, bits: [0, 0, 0], name: '坤', sym: '☷', xiang: '地', role: '女阴',     kind: '真体' },
  { code: 1, bits: [1, 0, 0], name: '震', sym: '☳', xiang: '雷', role: '阴壳女阳', kind: '假壳' },
  { code: 2, bits: [0, 1, 0], name: '坎', sym: '☵', xiang: '水', role: '男阴',     kind: '真体' },
  { code: 3, bits: [1, 1, 0], name: '兑', sym: '☱', xiang: '泽', role: '阴壳男阳', kind: '假壳' },
  { code: 4, bits: [0, 0, 1], name: '艮', sym: '☶', xiang: '山', role: '阳壳女阴', kind: '假壳' },
  { code: 5, bits: [1, 0, 1], name: '离', sym: '☲', xiang: '火', role: '女阳',     kind: '真体' },
  { code: 6, bits: [0, 1, 1], name: '巽', sym: '☴', xiang: '风', role: '阳壳男阴', kind: '假壳' },
  { code: 7, bits: [1, 1, 1], name: '乾', sym: '☰', xiang: '天', role: '男阳',     kind: '真体' },
];
const BY_CODE = Object.fromEntries(GUA.map(g => [g.code, g]));
const BY_NAME = Object.fromEntries(GUA.map(g => [g.name, g]));
const BY_ROLE = Object.fromEntries(GUA.map(g => [g.role, g]));

// ---------- 基本位运算 ----------
const isShell = c => (c & 1) !== ((c >> 2) & 1);        // 三爻(外显) != 初爻(能量) → 有壳
const energy  = c => c & 1;                              // 初爻：1阳 0阴
const sex     = c => (c >> 1) & 1;                       // 二爻：1男 0女
const show    = c => (c >> 2) & 1;                       // 三爻：1阳显 0阴显
// 剥壳归真：把三爻改回初爻 → 得到该人的真体卦
const toTrue  = c => (c & 0b011) | ((c & 1) << 2);
// 覆壳：真体卦 → 对应的带壳卦（三爻取反）
const toShell = c => (c & 0b011) | (((c & 1) ^ 1) << 2);

// ---------- 外显能量（用户 2026-09-24 定：三爻综合 = 外显能量，非内核）----------
// ⛔ 内核只由初爻决定（1 bit）。三爻加权和是**外显**能量，不是内核能量。
// 权重：初爻 4 ／ 二爻 2 ／ 三爻 1 —— 与先天八卦次序（乾1兑2离3震4巽5坎6艮7坤8）一致。
const W = [4, 2, 1];
const weightR   = c => ((c & 1) * 4) + (((c >> 1) & 1) * 2) + ((c >> 2) & 1); // 0–7
const yangCount = c => (c & 1) + ((c >> 1) & 1) + ((c >> 2) & 1);             // 0–3（简单计数）
const rPercent  = c => +(weightR(c) / 7 * 100).toFixed(1);                    // 外显阳能量 %
const xianTian  = c => 8 - weightR(c);                                        // 先天序 1–8
// 内核（真）与外显的偏离度：壳越厚偏离越大
const deviation = c => weightR(c) - ((c & 1) ? 7 : 0);                        // 与纯乾/纯坤的差

// ---------- 难度系数（=|偏离|，0–3；三爻权重天然给出，无需另定义）----------
const difficulty = c => Math.abs(deviation(c));   // 乾0 兑1 离2 震3 巽3 坎2 艮1 坤0

// ---------- L4 · 关系卦（我 3bit × 对方 3bit，一码三读）----------
// ⭐⭐ v5（2026-09-24，用户洞察）：上卦 = 对方的**完整卦码**，与下卦三爻**同构**。
//   父母 / 伴侣 / 子女 / 朋友本身就是一个人 → 本身就是一个卦 → 无需为上卦另发明维度。
//     下卦 bit0=内核 bit1=性别 bit2=外显
//     上卦 bit3=内核 bit4=性别 bit5=外显        ← 同一套语义，只是换了人
//   由此，代际传递 v2 的两个传递物**已被编进码里**，不再需要额外爻位：
//     方式（他怎么对你）   = 上卦三爻 = 对方外显   ← R1a
//     要求（他要你成为什么）= 上卦初爻 = 对方内核   ← R1b
//   用户原话：「父母对待我的方式，其实就对应父母的外显，上卦三爻跟下卦三爻一样，
//              不需要搞三个维度。」
// ⚠️ 只有「非人格的场」（社会 / 集体意识 / 时代）才是推演层：场不是人，没有内核和性别，
//    退化成只用外显一爻（见 fieldHex）。
// ⛔ v4 的 FIELD 三爻（场性质/场要求/场对壳态度）已废弃：那是无语料支撑的推演，
//    且被 v5 的同构方案取代。
const REL = {
  FATHER:  '父亲',
  MOTHER:  '母亲',
  PARTNER: '伴侣/双生',
  CHILD:   '子女',
  FRIEND:  '朋友/同事',
  FIELD:   '场(社会/集体意识)',
};
// 读法（决定怎么解释同一个码），不决定编码
const REL_READ = {
  FATHER:  '因果·他的方式(外显)与他要你成为的(内核)',
  MOTHER:  '因果·她的方式(外显)与她要你成为的(内核)',
  PARTNER: '镜像·互为对镜；两人视角互为综卦',
  CHILD:   '反向因果·你是子女的场',
  FRIEND:  '投射·同类相吸或互补',
  FIELD:   '⚠️ 推演层·场非人，仅取外显一爻',
};
const relHex = (me, other, rel) => ({
  code: hex(me, other), name: hexName(me, other),
  rel, label: REL[rel] || rel, read: REL_READ[rel] || '',
});
// 关系的两个视角：我×对方 与 对方×我 互为**综卦**（六爻倒转）
const relPair = (me, other, rel) => {
  const a = relHex(me, other, rel), b = relHex(other, me, rel);
  return { mine: a, theirs: b, note: '同一段关系，各自视角互为综卦' };
};
// 非人格的场：只用外显一爻(bit5)，bit3/bit4 恒 0
const fieldHex = (me, fieldShow) => ({
  code: hex(me, fieldShow << 2), name: hexName(me, fieldShow << 2),
  rel: 'FIELD', label: REL.FIELD, read: REL_READ.FIELD,
});

// ⭐⭐ 代际传递规则 v2（2026-09-24 由用户实际家庭数据修正，见下方 ⚠️）
//
// ⚠️ v1 曾写「传递物 = 父母外显」，被用户实际数据证伪：
//    用户父母 = 艮(阳壳女阴) + 巽(阳壳男阴)，两者外显(show) 皆为**阳**，
//    v1 据此预测传递"阳"；但用户实际继承的是**阴**
//    （不能锋芒太露/要乖/要收/多牺牲/多考虑他们/不能光考虑自己）。
//    → v1 错。真实机制是**两个传递物**，且方向可以相反。
//
// R1 父母向子女传递**两样东西**，来源不同：
//   R1a 方式（way）= 父母**外显** show(p)  → 子女**习得**的行为模式
//       依据 B105 00:35「孩子习得爱的方式，就是父母对他的方式」
//   R1b 要求（demand）= 父母**内核** energy(p) → 父母向子女**索取**的方向
//       内核阴(价值感要别人给) → 向子女索取 → 要求"乖/收/牺牲/多考虑我"
//       内核阳(价值感自己给)   → 不索取     → 要求"你自己站起来"
//       依据 B299 14:47「面具是用于迎合父母的需要」——迎合的是父母的**需要**=内核需求
const transmitWay    = p => show(p);      // 方式：外显
const transmitDemand = p => energy(p);    // 要求：内核
// R2 壳由「要求」决定，不由「方式」决定
//     用户验证：艮母(内核阴→要求阴) + 阳内核 + 女 → 震(阴壳女阳) ✅ 与自认一致
const inherit = (parentCode, childKernel) => {
  const way = transmitWay(parentCode), demand = transmitDemand(parentCode);
  return { way, demand, childKernel,
           effect: demand === childKernel ? '固化内核' : '生成壳',
           isShell: demand !== childKernel };
};
// R3 ⭐ 撕裂的真正来源：父母**自身带壳**（外显≠内核）→ 方式与要求方向相反 → 子女收到矛盾指令
//     艮(阳壳女阴)：方式阳(强硬/控制/要强) + 要求阴(乖/牺牲/考虑我) → 矛盾
//     真体父母（乾/坤/离/坎）：方式 == 要求 → 单一信号 → 不撕裂
const parentTear = p => isShell(p) ? 1 : 0;                       // 单亲 0/1
const familyTear = (f, m) => parentTear(f) + parentTear(m);       // 双亲 0–2
// R4 业力 = 父母未化解的壳，通过矛盾指令传给子女
const transmitsShell = parentCode => isShell(parentCode);
// 子女卦合成：内核 + 自身性别 + **父母要求(demand)** 作三爻
const childFrom = (kernel, sexBit, parentCode) => kernel | (sexBit << 1) | (transmitDemand(parentCode) << 2);
// ⛔ v1 的 transmit / tear 已废弃（语义错误），保留名以报错提示
const transmit = p => { throw new Error('transmit 已废弃(v2)：请改用 transmitWay(方式) / transmitDemand(要求)'); };
const tear = () => { throw new Error('tear 已废弃(v2)：撕裂源于父母带壳，请改用 parentTear / familyTear'); };

// ---------- L1.5 · 维度层：规训集（injunction set）----------
// ⛔ 三爻不动。维度层是**并行的因果层**：解释这个卦是怎么来的，并让破壳可计算。
// ⭐ 破壳不是改卦码，是**删训**——卦码自动跟着变。这才是"反编译"。
//
// 训 = { source, dir, strength }
//   dir      1=要求显阳 / 0=要求显阴
//   strength 0–3（0=已解除）
// 性别脚本训由二爻自动派生，强度固定 2（= 二爻权重），**不可删除**，只能超越（B390）。
const SEX_STRENGTH = 2;
const sexInj = sexBit => ({ source: '性别脚本', dir: sexBit, strength: SEX_STRENGTH });

// 合力：与内核相反的训 vs 与内核同向的训
function balance(kernel, injs) {
  let against = 0, for_ = 0;
  for (const i of injs) { if (i.dir === kernel) for_ += i.strength; else against += i.strength; }
  return { against, for_, margin: Math.abs(against - for_),
           show: against > for_ ? 1 - kernel : kernel,   // 平局 → 内核胜（无壳）
           hasShell: against > for_ };
}
// 由训集合成卦码
function codeFromInj(kernel, sexBit, injs) {
  const b = balance(kernel, [sexInj(sexBit), ...injs]);
  return { code: kernel | (sexBit << 1) | (b.show << 2), balance: b };
}
// ⭐ 破壳路径：按强度降序逐条解除反向训，给出翻转所需的操作序列
function shedPath(kernel, sexBit, injs) {
  const start = codeFromInj(kernel, sexBit, injs);
  const against = injs.filter(i => i.dir !== kernel && i.strength > 0)
                      .sort((a, b) => b.strength - a.strength);
  const steps = []; let cur = start.code, removed = [];
  for (let n = 0; n < against.length; n++) {
    const keep = injs.map(i => removed.includes(i.source) || i.source === against[n].source
      ? { ...i, strength: 0 } : i);
    removed.push(against[n].source);
    const r = codeFromInj(kernel, sexBit, keep);
    steps.push({ removed: against[n].source, strength: against[n].strength,
                 code: r.code, name: BY_CODE[r.code].name, role: BY_CODE[r.code].role,
                 r: weightR(r.code), flipped: !isShell(r.code) });
    cur = r.code;
    if (!isShell(r.code)) break;
  }
  return { start: { code: start.code, name: BY_CODE[start.code].name, role: BY_CODE[start.code].role },
           steps, end: { code: cur, name: BY_CODE[cur].name, role: BY_CODE[cur].role } };
}

// ---------- 代际传递 v3 · 场 · 抱持（2026-09-24，由 5 个家庭案例 + 用户生命史修订）----------
// 本轮新增实证：前夫家 / 大姨家 / 二姨家 / 小舅舅家 / 大舅舅家 + 用户完整轨迹
//
// ⭐ R5'' 传递者 = **主养者**，不是生母
//    实证：外孙女由大姨(震·内核阳)带大 → 按生母艮算得震(❌)，按主养者大姨算得离(✅)
//    此前悬置的反例就此解开。命中 10/11。
//    唯一反例（外孙）提示：主养者对不同性别子女的规训强度可能不同 → 待更多样本。
//
// ⭐ R6 壳不遗传，内核才遗传
//    实证：小舅舅(巽·阳壳) → 儿子小表哥(坎·无壳)
//    传递的是**内核**（要求阴），不是**外显**（壳）。
//    壳是「要求 vs 子女内核」在子女身上现场冲突的产物，不是从父母身上复制来的。
//
// ⭐ R7 壳有两个来源
//    来源A · 父母：父母要求 ≠ 子女内核 → 造壳（用户震、大姨女儿艮）
//    来源B · 场：社会 / 军队 / 家族期待 → 造壳（小舅舅巽、表哥巽）
//    ⚠️ childFrom() 只覆盖来源A；来源B 必须由维度层规训集表达。
//
// ⭐ R8 抱持 = 同向训增强器（破壳路线B）
//    难度3（震/巽）的性别脚本训强度 2 且**不可删除** → 单靠删反向训可能永远差一口气
//    → 必须有外显阳的人承托，补上同向力。
//    实证：用户「在他的抱持下，我终于慢慢接受了真实的自己」
//
// ⭐ R9 卦码可变：主养者切换 → 卦码改变
//    实证：离（爷爷奶奶抚养）→ 震（被父母接回）→ 离（剥壳后）
//    起点的离 = 还没被要求过（天然）；终点的离 = 被要求过、长过壳、又自己脱下来（真实）
//    ⇒ 内核（初爻）全程未变，两次翻转都只发生在**第三爻**。

const childFrom2 = (kernel, sexBit, primaryCode) => childFrom(kernel, sexBit, primaryCode);

// 场训：dir = 场要求你显什么。场没有内核与性别，只占这一爻。
const fieldInj = (dir, strength, source) => ({ source: source || '场', dir, strength });
// 抱持训：抱持者的**外显**决定他能承托的方向
const holdInj = (holderCode, strength) => ({
  source: '抱持·' + BY_CODE[holderCode].name, dir: show(holderCode), strength });

// 从 家庭 + 场 + 抱持 自动生成规训集
function buildInjSet(o) {
  const injs = [];
  const mk = (code, label, strength) => ({
    source: label + BY_CODE[code].name + '(要求' + (transmitDemand(code) ? '阳' : '阴') + ')',
    dir: transmitDemand(code), strength: strength == null ? 2 : strength });
  if (o.mother != null) injs.push(mk(o.mother, '母·', o.mStrength));
  if (o.father != null) injs.push(mk(o.father, '父·', o.fStrength));
  for (const f of (o.fields || [])) injs.push(fieldInj(f.dir, f.strength, f.source));
  for (const h of (o.holds  || [])) injs.push(holdInj(h.code, h.strength));
  for (const x of (o.extra  || [])) injs.push(x);
  return injs;
}

// ⭐ 破壳路线B：不删训，而是**增强同向训**（抱持 / 真实成就 / 被认可的经验）
function strengthenPath(kernel, sexBit, injs, maxAdd) {
  const start = codeFromInj(kernel, sexBit, injs);
  const need = start.balance.against - start.balance.for_ + 1;  // 至少补到 同向 > 反向
  const steps = []; let cur = start.code;
  for (let add = 1; add <= (maxAdd || 8); add++) {
    const r = codeFromInj(kernel, sexBit, [...injs, { source: '外部承托(抱持)', dir: kernel, strength: add }]);
    steps.push({ added: add, code: r.code, name: BY_CODE[r.code].name, role: BY_CODE[r.code].role,
                 against: r.balance.against, for_: r.balance.for_, flipped: !isShell(r.code) });
    cur = r.code;
    if (!isShell(r.code)) break;
  }
  return { start: { code: start.code, name: BY_CODE[start.code].name, role: BY_CODE[start.code].role },
           needAtLeast: Math.max(0, need), steps,
           end: { code: cur, name: BY_CODE[cur].name, role: BY_CODE[cur].role } };
}

// 纵向轨迹：同一个人的卦码可以随主养者/场切换而改变
function trajectory(stages) {
  return stages.map((s, i) => ({
    ...s, name: BY_CODE[s.code].name, role: BY_CODE[s.code].role,
    kernel: energy(s.code), show_: show(s.code), shell: isShell(s.code),
    diff: i ? { kernelChanged: energy(s.code) !== energy(stages[i - 1].code),
                showChanged:  show(s.code)     !== show(stages[i - 1].code) } : null }));
}

// ---------- 代际传递 v4 · 溯源释放 / 序位投射（2026-09-24，由用户"过了课题"的自述修订）----------
//
// ⭐ R10 溯源 = 解除（可命名即脱钩）
//    用户原话：「过了原生家庭课题之后，就能准确区分自己身上的阳性和阴性分别来自哪里」
//    编码含义：一条规训一旦被**指认来源**，就从「我在执行」变成「我看见它在执行」
//    → 脱离自动控制 → 有效强度归零。
//    ⇒ **可操作定义：能逐条说出「这条来自谁/哪个场/什么时候装上的」= 该条已解除**
//    ⇒ 反向指标：**说不出来源的条数 = 剩余课题量**
//    注意：指认来源 ≠ 立刻没有情绪。指认是从「被它驱动」变成「看着它」，
//          强度归零指的是**决策权重**，不是情绪强度。
//
// ⭐ R11 序位投射：父母/场把某个**序位的功能要求**投到子女身上
//    实证：用户是长女，父亲去世后被要求充当「父亲/顶梁柱」→ 序位训 = 显阳
//         与性别脚本训（女→显阴）**正面冲突** → 对冲，两条都不可能被满足
//    ⇒ 这正是「震」身上「自强」与「讨好」并存、且互相打架的结构性来源
//    规则：rankInj(rank, sexBit) 的方向由**序位功能**定，不由性别定；
//          当 序位方向 ≠ 性别脚本方向 时，标记 conflict=true（对冲训）
//
// ⭐ 补偿性符号 = 被压爻的反向泄漏（可观测外显特征）
//    实证：用户（震·内核阳被压成阴显）对 HelloKitty 的执念——
//          到日本也要去看、衣柜里全是 → 阴性符号的**过度消费**
//    编码含义：被压抑那一爻会以**符号/消费品**的形式反向泄漏出来，
//          且强度与被压程度正相关。这是壳的**外部可见指纹**。

// R10 · 溯源：给规训打上 origin（谁 / 哪个场 / 何时装上）
function traceInj(inj, origin) {
  return { ...inj, origin: origin || null,
           traced: !!(origin && origin.from),
           released: false };
}
// R10 · 释放：已指认来源的训 → 决策权重归零（情绪权重保留）
function releaseInj(inj) { return { ...inj, released: true, effStrength: 0 }; }
// R10 · 审计：返回已溯源 / 未溯源 / 已释放 三类，**未溯源条数 = 剩余课题量**
function audit(injs) {
  const traced   = injs.filter(i => i.traced && !i.released);
  const untraced = injs.filter(i => !i.traced);
  const released = injs.filter(i => i.released);
  const remain   = untraced.reduce((s, i) => s + i.strength, 0);
  return { total: injs.length,
           traced: traced.length, untraced: untraced.length, released: released.length,
           remainStrength: remain,
           progress: injs.length ? Math.round(released.length / injs.length * 100) : 0,
           untracedList: untraced.map(i => i.source),
           note: '未溯源条数 = 剩余课题量；指认来源即解除' };
}
// R10 · 释放后重算卦码：被释放的训不再参与合力
function afterRelease(kernel, sexBit, injs, sources) {
  const next = injs.map(i => (sources.includes(i.source) ? releaseInj(i) : i));
  const live = next.filter(i => !i.released);
  const r = codeFromInj(kernel, sexBit, live);
  return { code: r.code, name: BY_CODE[r.code].name, role: BY_CODE[r.code].role,
           shell: isShell(r.code), balance: r.balance, injs: next,
           audit: audit(next) };
}

// R11 · 序位投射
const RANK = { ELDEST: '长子/长女(顶梁柱·显阳)', MIDDLE: '中间(隐形人·显阴)', YOUNGEST: '幼子/幼女(被照顾·显阴)' };
function rankInj(rank, sexBit, strength, source) {
  const dir = rank === 'ELDEST' ? 1 : 0;              // 序位功能方向：长子=扛事=显阳
  const sexDir = sexBit ? 1 : 0;                      // 性别脚本方向：男=显阳 / 女=显阴
  return { source: source || ('序位·' + RANK[rank].split('(')[0]),
           dir, strength: strength == null ? 2 : strength,
           rank, conflict: dir !== sexDir,
           note: dir !== sexDir ? '⚠️ 对冲训：序位要求与性别脚本正面冲突，两条都不可能被满足' : '' };
}

// 补偿性符号 · 壳的外部可见指纹（被压那一爻的反向泄漏）
const COMPENSATE = {
  '震': ['HelloKitty / 粉色 / 少女符号的过度消费', '对「被保护」「有人撑腰」的强烈向往'],
  '巽': ['权力符号 / 头衔 / 排场 / 人上人叙事', '对被羞辱的过度敏感'],
  '艮': ['「我都是为了你们」的反复诉说', '对公平/被看见的强烈索取'],
  '兑': ['示弱 / 无害化自我呈现', '对「被喜欢」的过度经营'],
  '离': [], '坎': [], '乾': [], '坤': []   // 真体无泄漏：外显即内核
};
const compensate = code => COMPENSATE[BY_CODE[code].name] || [];

// ---------- 代际传递 v5 · 场的筛选 / 行为指纹 / 改写（2026-09-24，由母系匮乏感素材修订）----------
//
// ⭐ R12 场有**作用对象筛选**：同一条业力不会作用于所有家庭成员
//    实证：母系「金钱=死亡恐惧」只作用于**女性成员**（母亲 / 大姨 / 用户），
//          男性成员未见同样表现。父系「变强/追财富」则对男女都作用。
//    ⇒ fieldInj 增加 targets 字段（默认全部）。
//    ⇒ 推论：业力不是弥散的雾，是**带筛选条件的指令**。
//    ⇒ 这解释了为什么「同一个家族里每个人的课题不一样」。
//
// ⭐ R13 破壳路线 C = **改写（rewrite）**：改驱动源，不改行为
//    实证：用户年薪百万仍薅羊毛 / 只买大牌打折货；改后仍节俭，但动机由
//          「恐惧·我不配丰盛」变为「自主·金钱是能量的流动」。
//    ⇒ 编码：训 = { dir, strength, **basis** }；basis ∈ 'fear'(恐惧驱动) | 'choice'(自主选择)
//    ⇒ routeA 删训（行为消失）｜routeB 增强同向（外力顶过去）｜**routeC 改写（行为保留，驱动源替换）**
//    ⇒ ⭐ 判据体系的漏洞由此补上：
//       **同一个外显行为，可以有两个完全相反的驱动源**（薅羊毛 ≠ 节俭）
//       只看行为定卦会误判 → 必须追问动机。
//
// ⭐ 行为指纹（BEHAVIOR_FP）：可观测行为 → 反推训的存在
//    实证：大姨「退休金很高但不花钱，连电灯都不舍得开」——
//          不是经济问题，是训的问题。行为强度与收入脱钩 = 训的信号。
//    ⇒ 判据：**行为与客观条件脱钩** → 底下一定有一条训。

// R12 场训（带筛选）
function fieldInj2(dir, strength, source, targets) {
  return { source: source || '场', dir, strength, targets: targets || ['ALL'], field: true };
}
// R12 该场是否作用于此人
function fieldApplies(inj, sexBit) {
  if (!inj.targets || inj.targets.includes('ALL')) return true;
  return inj.targets.includes(sexBit ? 'M' : 'F');
}

// R13 改写：保留行为，替换驱动源
function rewriteInj(inj, opt) {
  const o = opt || {};
  return { ...inj, dir: o.dir != null ? o.dir : inj.dir,
           strength: o.strength != null ? o.strength : inj.strength,
           basis: o.basis || 'choice', rewritten: true };
}
// R13 判定：行为相同但驱动源已换 → 该条训的决策权重归零
const isRewritten = inj => inj.basis === 'choice' && inj.rewritten === true;
function rewritePath(kernel, sexBit, injs, rewriteSources) {
  const next = injs.map(i => (rewriteSources.includes(i.source) ? rewriteInj(i, { basis: 'choice' }) : i));
  const live = next.filter(i => !isRewritten(i));
  const r = codeFromInj(kernel, sexBit, live);
  return { code: r.code, name: BY_CODE[r.code].name, role: BY_CODE[r.code].role,
           shell: isShell(r.code), balance: r.balance, injs: next,
           kept: next.filter(i => isRewritten(i)).map(i => i.source),
           note: '被改写的训：行为保留，驱动源由恐惧换为自主 → 决策权重归零' };
}

// 行为指纹：可观测行为 → 反推训（用于交叉验证，不单独定卦）
const BEHAVIOR_FP = [
  { fp: '收入充裕但极度节俭（薅羊毛/只买打折/不舍得开灯）', inj: '金钱=死亡恐惧', dir: 0, hint: '行为与客观条件脱钩 → 底下一定有训' },
  { fp: '收入一般但必须消费符号（大牌/排场/头衔）', inj: '价值=被看见', dir: 1, hint: '巽/艮 的补偿性符号' },
  { fp: '不敢提要求 / 不敢涨价 / 不敢报价', inj: '不配得', dir: 0, hint: '母系业力典型' },
  { fp: '必须先付出才敢接受', inj: '价值要换', dir: 0, hint: '讨好型人格的底层训' },
  { fp: '过度储备 / 囤积 / 囤课 / 囤资料', inj: '未来会匮乏', dir: 0, hint: '匮乏感的时间投射' },
  { fp: '赚到钱后立刻出事（破财/生病/关系崩）', inj: '丰盛会招来惩罚', dir: 0, hint: '⚠️ 最重的一条，常伪装成"命"' },
];
const matchBehavior = kw => BEHAVIOR_FP.filter(b => b.fp.includes(kw) || b.inj.includes(kw));

// ---------- 代际传递 v6 · 动机层（2026-09-24，由用户父系业力闭环素材修订）----------
//
// ⭐⭐ R14 真实阴阳由**动机(basis)**决定，dir 只描述行为
//    实证（用户原话）：「我要考上好大学，让那些曾经看不起我的对我刮目相看，
//                    我要挣很多钱证明自己 —— 但在这个过程中却已经完全失去了自己」
//    拆解：行为 dir=1（变强/赚钱），与她的内核(阳)**一致** → 按行为判，这是真阳
//          动机 basis=fear（为了让别人看） → 价值感要别人给 → 按锚点判，这是**阴**
//    ⇒ **行为对了不代表对了。动机不对，做得越多离自己越远。**
//
//    ⭐ 这直接回到唯一语义锚点：
//       1(阳) = 价值感自己给的 ｜ 0(阴) = 价值感要别人给的
//       basis=choice → 向内求 → 阳 ｜ basis=fear → 向外求 → 阴
//    ⇒ dir 是**行为层**的量，basis 才是**阴阳层**的量。两者可以分离。
//
// ⭐⭐ 由此得出两种壳（此前只有一种）：
//    ① 行为壳 = dir ≠ kernel        → 已知的四隅卦（震/巽/艮/兑）
//    ② **动机壳 = dir = kernel 但 basis = fear** → 行为与内核一致，动机却外求
//       ⇒ 「假阳」(B100) 的精确编码定义：dir=1 且 basis=fear
//       ⇒ 动机壳**不在卦码上显形**（三爻只记行为），只能靠追问动机发现
//       ⇒ 这是卦码体系的已知盲区，必须靠 basis 字段补
//
// ⭐⭐ 反噬机制（"金钱被收回"）的结构性解释
//    实证：叔叔伯伯早逝 / 堂哥破产 / 用户在婚姻里被吞噬所有财产
//    机制：假阳驱动的成就，地基是**外求**的（建立在别人的目光上）
//          → 一旦外部目光撤走，或主体自己不再需要它 → 结构塌
//    ⇒ 反噬不是玄学惩罚，是**结构性必然**：用阴的地基盖阳的楼
//    ⇒ 编码：retribution() 累加所有「dir=内核 且 basis=fear」的训强度 = 塌房风险
//
// ⭐ 用户自觉状态的锚点确认（首次从内部验证）
//    「我的价值来源于我自己，不来源于外在」
//    「家是心安处，即便是陋室；安全感是自己给的」
//    ⇒ 用户用自己的话**复述了锚点定义** = 编码体系第一次得到主体侧的正面确认
//      此前所有验证都是从外部行为反推，这一次是从内部自觉正推。

const BASIS = { fear: '向外求（价值感要别人给→阴）', choice: '向内求（价值感自己给的→阳）' };

// 真实阴阳：由动机定，不由行为定
const motiveEnergy = inj => (inj.basis === 'fear' ? 0 : 1);

// 两类壳
function shellKind(kernel, inj) {
  const behavioral   = inj.dir !== kernel;
  const motivational = inj.basis === 'fear';
  if (behavioral && motivational) return { kind: '双重壳', behavioral: true, motivational: true,
    note: '行为反了，动机也是外求的 → 最难，但反噬风险反而低（因为成就本就没建立起来）' };
  if (behavioral)   return { kind: '行为壳', behavioral: true, motivational: false,
    note: '行为与内核相反 → 四隅卦，在卦码上可见' };
  if (motivational) return { kind: '动机壳', behavioral: false, motivational: true,
    note: '⚠️ 行为与内核一致，但动机外求 → 卦码上看不出来，只能靠追问动机 → 「假阳」' };
  return { kind: '无壳', behavioral: false, motivational: false, note: '行为与动机都对 → 真体' };
}

// 「假阳」的精确判定：行为显阳，动机外求
const pseudoYang = inj => inj.dir === 1 && inj.basis === 'fear';
const pseudoYin  = inj => inj.dir === 0 && inj.basis === 'fear';

// 反噬风险：所有「行为顺内核、动机却外求」的训，强度之和 = 塌房风险
function retribution(kernel, injs) {
  const fake = injs.filter(i => i.dir === kernel && i.basis === 'fear');
  const risk = fake.reduce((s, i) => s + i.strength, 0);
  return { risk, count: fake.length, sources: fake.map(i => i.source),
    level: risk >= 6 ? '高' : risk >= 3 ? '中' : '低',
    note: '用阴的地基盖阳的楼 → 外部目光撤走即塌。反噬是结构性必然，不是惩罚' };
}

// ⭐ 「相」 vs 「性」（用户原话：「抛弃只是一个相而已」）
//     相 = 行为层，可观测，可重复   ｜ 性 = 动机层，需追问，可变
//    ⇒ **同一个相，可以有不同的性** —— 这是改写路线的哲学基础
//    ⇒ 编码含义：不要用「他做了什么」判人，要用「他为什么做」判人
// ---------- 代际传递 v7 · 献祭 / 失去反应 / 抱持的本质（2026-09-24，由 7 项校正修订）----------
//
// ⭐⭐ R5''' 决定性验证：**传递者是主养者，可以不是父母**（2026-09-24 由母亲案例确认）
//    实证：外婆差点送走母亲 → **大姨辍学赚工分把她留下并养大** → 母亲把大姨投射成母亲
//       · 按生母(外婆,内核阴)算 → 得坤 ≠ 实际 ❌
//       · 按主养者(大姨·震,内核阳)算 → 得**艮（阳壳女阴）** ✅ 完全命中
//    同一套规则解释三个人，命中 3/3：
//       母亲(内核阴 + 主养者震) → 艮 阳壳
//       用户(内核阳 + 主养者艮) → 震 阴壳
//       妹妹(内核阴 + 主养者艮) → 坤 无壳
//    ⇒ 主养者可以是**任何长期抚养者**（姐姐/祖辈/寄养家庭），不限于父母。
//    ⇒ 母亲的艮此前我推定为「必须撑起来」，真正机制是：
//       **大姨(内核阳)要求她显阳，而她内核是阴 → 生成阳壳**。外观要强 = 艮的外显。
//
// ⭐ R16 献祭 = 训的**极端形式**
//    实证（用户原话）：「13岁的我，我必须扛，不是我自主的选择，而是**无意识为家族献祭**」
//    编码：献祭 = basis=fear + strength=3 + **主体无意识**（不知道自己在被驱动）
//    ⇒ 与「选择」的区别：献祭者**说不出自己在献祭**，只觉得"应该"。
//    ⇒ 判据：能说出「我在献祭」的那一刻，献祭就已经结束（回到 R10 溯源=解除）
//
// ⭐ R17 面对失去的反应，可区分**真阴**与**阳壳**（2026-09-24 由前夫 vs 双生对照确认）
//    实证：同样是用户提出离开——
//       · 前夫·坎（真体男阴）→ **哭了，求她不要离开**，害怕被抛弃
//       · 双生·巽（阳壳男阴）→ **很决绝地同意**，不示弱
//    ⇒ **真阴（坎）**：表达脆弱、请求留下、承载
//    ⇒ **阳壳（巽）**：决绝、立刻同意、不示弱
//    ⇒ ⚠️ 决绝 ≠ 强大。决绝是**壳的反应**（不能示弱）。
//    ⇒ 这是一个**高区分度的可观测判据**，可写进测评题项。
//
// ⭐⭐ R18 抱持 = **被看见**；承载 ≠ 抱持
//    实证（用户原话）：灵魂共振，「**两个真实的自我都被对方看见过**」，
//                    「这是我在婚姻关系中没有得到过的」
//    拆解：前夫给了**承载**（无条件牺牲、一味承载）但不给她**看见** → 不能剥壳
//          双生给了**看见**（真实自我被看见）→ 能剥壳
//    ⇒ 承载是阴的给予（给，但不看），抱持是**对内核的确认**（看见）
//    ⇒ 抱持的有效性条件：① basis=choice ② **双向**（互相看见）
//    ⇒ 单方面的抱持（只有一方被看见）不能剥壳

// ⭐⭐ R19 情绪通道（affect channel）：一个**独立于三爻**的维度
//    实证（用户对比双生 vs 前夫）：
//       · 前夫·坎（真体男阴）：养育环境**允许**情绪表达 → 感性流露、当面哭 → 情绪通道**开**
//       · 双生·巽（阳壳男阴）：养育环境**不允许**情绪表达 → 几乎完全封闭、感知不到喜怒哀乐 → 通道**闭**
//    ⇒ **同样内核阴的男人，差别就在情绪通道开不开**
//       通道开 → 坎（真阴，能承载、能表达脆弱）
//       通道闭 → 巽（阳壳，理性脑代偿、决绝、感觉不到）
//    ⇒ ⭐ 理性脑的强度 = 壳的厚度。情绪被封，能量只能走理性通道 → 理性异常发达。
//       **「他理性脑强很多很多」不是优势，是壳的代偿症状。**
//    ⇒ 这解释了：决绝断舍离不是想清楚了，是**感觉不到**；
//       你讨好乞求他回避拒绝，是因为连接需要情绪通道，而他的通道是关的。
//
//    ⇒ ⭐ R7 造壳的**第三个来源**（此前只有 A父母 / B场）：
//       **来源C · 情绪禁止**：养育环境不允许情绪表达 → 内核被封 → 必成壳
//
// ⭐⭐ 痛感差异：震与巽同为难度 3，但**难的方式不同**
//    · 震（阴壳）：**知道自己难受** → 有信号，内外撕裂，痛感明确
//    · 巽（阳壳）：**连自己难受都不知道** → 无信号
//    ⇒ **有痛感 = 有信号；无信号更难。** 巽的实际难度高于震。

const AFFECT = { OPEN: '情绪通道开（养育环境允许表达）', SHUT: '情绪通道闭（养育环境禁止表达）' };

// 情绪通道 → 是否成壳
function affectChannel(open, kernel) {
  if (open) return { open: true, shell: false,
    note: '情绪通道开 → 即使内核是阴，也能是真体（坎/坤）：感得到，才承载得了' };
  return { open: false, shell: true,
    note: '情绪通道闭 → 内核被封 → 必成壳（巽/艮）：感觉不到，只能靠理性脑代偿' };
}

// 情绪禁止训（造壳来源C）
const affectInj = (strength, source) => ({
  source: source || '养育环境·情绪禁止', dir: 1, strength: strength == null ? 3 : strength,
  basis: 'fear', kind: 'AFFECT',
  note: '⚠️ 造壳来源C：不允许表达情绪 → 内核被封，外显只能走理性/决绝' });

// 痛感 / 自知度：同样是难度 3，谁更难
function shellAwareness(code) {
  const n = BY_CODE[code].name;
  if (n === '震') return { gua: n, pain: 2, aware: 2, level: '知道自己难受',
    note: '内外撕裂，痛感明确 → **有信号**，破壳有抓手' };
  if (n === '巽') return { gua: n, pain: 0, aware: 0, level: '连自己难受都不知道',
    note: '无痛感 → **无信号** → 实际难度高于震：不知道自己有问题，就不会去找出口' };
  if (n === '艮') return { gua: n, pain: 1, aware: 1, level: '知道自己难受，但归因向外',
    note: '痛感转为戾气/索取 → 信号被误读为「别人对不起我」' };
  if (n === '兑') return { gua: n, pain: 1, aware: 1, level: '知道自己难受，但用讨好掩盖',
    note: '痛感转为经营被喜欢 → 信号被误读为「我再乖一点就好了」' };
  return { gua: n, pain: 0, aware: 2, level: '真体', note: '内外一致，无撕裂' };
}

// ⭐⭐ R20 壳可回弹（relapse）
//    实证：用户剥壳过程中，与双生分离后「一次一次地讨好乞求恢复链接」
//    ⇒ 被抛弃 / 被拒绝 = **壳的触发器**，外显爻会翻回壳
//    ⇒ 回弹 ≠ 失败。训的决策权重已归零 ≠ 行为模式不再被应激触发。
//    ⇒ ⭐ 关键区分：**解除是决策层的事，回弹是应激层的事。**
//       不要因为「我还是会讨好」就判定自己没好。
const RELAPSE_TRIGGER = ['被抛弃', '被拒绝', '失去连接', '被忽视', '权威否定'];

function relapse(kernel, sexBit, trueCode, trigger) {
  const shellCode = kernel | (sexBit << 1) | ((kernel ? 0 : 1) << 2); // 外显翻回与内核相反
  return { trigger, from: BY_CODE[trueCode].name, to: BY_CODE[shellCode].name,
    code: shellCode, shell: isShell(shellCode),
    isTrigger: RELAPSE_TRIGGER.some(t => (trigger || '').includes(t)),
    note: '回弹 ≠ 失败。训的决策权重归零是决策层的事；'
        + '被触发时行为模式仍会应激复现，这是应激层的事。' };
}

// R16 献祭判定
function sacrifice(inj, aware) {
  const is = inj.basis === 'fear' && inj.strength >= 3 && !aware;
  return { isSacrifice: is, basis: inj.basis, strength: inj.strength, aware: !!aware,
    note: is ? '⭐ 献祭：恐惧驱动 + 强度3 + 主体无意识 → 他不知道自己在献祭，只觉得「应该」'
             : (aware ? '已觉察 → 献祭结束（回到 R10：能说出「我在献祭」的那一刻就结束了）'
                      : '未达献祭阈值') };
}

// R17 面对失去的反应 → 反推真阴 / 阳壳
function lossReaction(o) {
  // o: { vulnerable:bool（表达脆弱/请求留下）, decisive:bool（决绝/立刻同意） }
  if (o.vulnerable && !o.decisive)
    return { type: '真阴（坎/坤）', note: '表达脆弱、请求留下、承载 → 内核与外显一致' };
  if (o.decisive && !o.vulnerable)
    return { type: '⚠️ 阳壳（巽/艮）', note: '决绝、不示弱 → 决绝 ≠ 强大，是壳的反应（不能示弱）' };
  if (o.vulnerable && o.decisive)
    return { type: '混合', note: '既脆弱又决绝 → 可能处于剥壳进行中' };
  return { type: '未表态', note: '信息不足' };
}

// R18 抱持 vs 承载
function attachment(o) {
  // o: { seen:bool（真实自我被看见）, mutual:bool（双向）, basis }
  const isHold = !!o.seen && o.basis !== 'fear';
  if (!o.seen)
    return { type: '承载（≠抱持）', canShed: false,
      note: '给了很多，但没有「看见」→ 不能剥壳。承载是阴的给予，抱持是对内核的确认' };
  if (!o.mutual)
    return { type: '单向抱持', canShed: false,
      note: '只有一方被看见 → 不能剥壳。抱持必须双向' };
  if (o.basis === 'fear')
    return { type: '⚠️ 恐惧驱动的抱持', canShed: false,
      note: '看见了，但动机是外求（怕失去/需要被需要）→ 不是抱持，是依赖。不能剥壳' };
  return { type: '⭐ 抱持（双向）', canShed: true,
    note: '两个真实的自我都被对方看见 → 唯一能补上「性别脚本训不可删除」那口气的外力' };
}

const XIANG = '相 · 行为层（可观测、可代际重复）';
const XING  = '性 · 动机层（需追问、可变）';
const xiangXing = (xiang, xing) => ({ xiang, xing, XING, XIANG,
  sameForm: true,
  note: '相同：' + xiang + ' ｜ 不同：' + xing + ' → 判断落在性，不落在相' });

// ⭐⭐ R15 解除的**行为级验收**：无疚 + 仍有爱
//    实证（用户原话）：「我承认自己抛弃了女儿没有争抚养权，同时毫无愧疚感……
//                    同时我又在寒假暑假的时候一个人带女儿，给了她富足的陪伴」
//    为什么这是最强证据：
//      「母亲不该抛弃孩子」是一条**强度极高的社会训**。
//      若仍在执行 → 必然产生愧疚。若无愧疚 → 只剩两种可能：训已解除 / 情感解离。
//      ⇒ 区分方法是第二个变量：**是否仍有爱**（care）。
//    ⇒ ⭐ 判据：**解除 = 无疚 + 仍有爱**。两者缺一都不是解除。
//      · 无疚 + 无爱 = ⚠️ 解离 / 情感隔离，不是解除
//      · 有疚 + 有爱 = 仍在执行（还没过课题）
//      · 有疚 + 无爱 = 训与情感同时枯竭
//    这是 R10（能指认来源）之上的**第二道验收**，且更难伪造。
function releaseCheck(o) {
  const guilt = o.guilt || 0, care = o.care || 0;   // 各 0–3
  let verdict, note;
  if (guilt === 0 && care > 0) {
    verdict = '已解除';
    note = '无疚 + 仍有爱 → 训的决策权重真的归零，不是自我说服';
  } else if (guilt === 0 && care === 0) {
    verdict = '⚠️ 疑似解离';
    note = '无疚但也无爱 → 可能是情感隔离，不是解除。需进一步鉴别';
  } else if (guilt > 0 && care > 0) {
    verdict = '仍在执行';
    note = '有疚 + 有爱 → 还在被这条训驱动（还没过课题）';
  } else {
    verdict = '⚠️ 训与情感同时枯竭';
    note = '有疚但无爱 → 需关注，不是解除状态';
  }
  return { guilt, care, verdict, note,
    passing: verdict === '已解除',
    strength: o.socialStrength == null ? 3 : o.socialStrength,
    note2: '社会训越强，无疚越难 → 越能作为解除的证据' };
}

// 三代同构：同一个「相」在代际链上重复出现，但「性」可以不同
function lineageChain(steps) {
  // steps: [{ gen:'外婆', xiang:'送走/不养', xiangKey:'抛弃', xing:'匮乏所迫', basis:'fear' }, ...]
  // xiangKey 用于判定「同一个相」是否在代际间重复（同一行为的不同说法归一）
  const key = s => s.xiangKey || s.xiang;
  return steps.map((s, i) => {
    const rep = i > 0 && steps.slice(0, i).some(p => key(p) === key(s));
    const prev = steps.slice(0, i).filter(p => key(p) === key(s));
    const basisChanged = prev.length ? prev[prev.length - 1].basis !== s.basis : false;
    return { ...s, order: i + 1, repeated: rep, basisChanged,
      note: rep
        ? (basisChanged
            ? '⭐ 相重复，但**性已改变**（' + prev[prev.length - 1].basis + '→' + s.basis + '）→ 代际传递在此中断'
            : '⚠️ 相重复，性也重复 → 传递仍在继续')
        : '首现' };
  });
}

// 动机层审计：把规训集按 行为/动机 四象限分类
function auditMotive(kernel, injs) {
  const q = { 真阳: [], 假阳: [], 自主阴: [], 恐惧阴: [] };
  for (const i of injs) {
    const k = shellKind(kernel, i).kind;
    if (i.dir === kernel && !pseudoYang(i) && i.basis !== 'fear') q.真阳.push(i.source);
    else if (pseudoYang(i)) q.假阳.push(i.source);
    else if (i.basis === 'fear') q.恐惧阴.push(i.source);
    else q.自主阴.push(i.source);
  }
  const total = injs.length;
  const clean = q.真阳.length + q.自主阴.length;
  return { ...q, total, clean,
    progress: total ? Math.round(clean / total * 100) : 0,
    note: '真阳(行为+动机都对) + 自主阴(行为逆但动机自主) = 已通过；假阳/恐惧阴 = 待改写' };
}

// ---------- 卦变 ----------
const rev     = c => ((c & 1) << 2) | (c & 0b010) | ((c >> 2) & 1);  // 综卦（3bit 倒转）
const inv     = c => (~c) & 0b111;                                    // 错卦（全反，阴影）
const hex     = (lower, upper) => (lower & 0b111) | ((upper & 0b111) << 3); // 重卦 0–63
const unhex   = h => ({ lower: h & 0b111, upper: (h >> 3) & 0b111 });
const hexRev  = h => { let r = 0; for (let i = 0; i < 6; i++) r = (r << 1) | ((h >> i) & 1); return r; }; // 六爻倒转
const hexInv  = h => (~h) & 0b111111;

// ---------- 64卦标准名（上卦在前）----------
const HEX_NAMES = {
  '乾': { '乾':'乾为天','兑':'天泽履','离':'天火同人','震':'天雷无妄','巽':'天风姤','坎':'天水讼','艮':'天山遁','坤':'天地否' },
  '兑': { '乾':'泽天夬','兑':'兑为泽','离':'泽火革','震':'泽雷随','巽':'泽风大过','坎':'泽水困','艮':'泽山咸','坤':'泽地萃' },
  '离': { '乾':'火天大有','兑':'火泽睽','离':'离为火','震':'火雷噬嗑','巽':'火风鼎','坎':'火水未济','艮':'火山旅','坤':'火地晋' },
  '震': { '乾':'雷天大壮','兑':'雷泽归妹','离':'雷火丰','震':'震为雷','巽':'雷风恒','坎':'雷水解','艮':'雷山小过','坤':'雷地豫' },
  '巽': { '乾':'风天小畜','兑':'风泽中孚','离':'风火家人','震':'风雷益','巽':'巽为风','坎':'风水涣','艮':'风山渐','坤':'风地观' },
  '坎': { '乾':'水天需','兑':'水泽节','离':'水火既济','震':'水雷屯','巽':'水风井','坎':'坎为水','艮':'水山蹇','坤':'水地比' },
  '艮': { '乾':'山天大畜','兑':'山泽损','离':'山火贲','震':'山雷颐','巽':'山风蛊','坎':'山水蒙','艮':'艮为山','坤':'山地剥' },
  '坤': { '乾':'地天泰','兑':'地泽临','离':'地火明夷','震':'地雷复','巽':'地风升','坎':'地水师','艮':'地山谦','坤':'坤为地' },
};
const hexName = (lower, upper) => HEX_NAMES[BY_CODE[upper].name][BY_CODE[lower].name];

// ⛔ 上卦（场）三爻语义 v1 已废弃 —— 见上方 L4 v5 说明。
//    v1 曾定义 bit3=场性质 / bit4=场要求 / bit5=场对壳态度，属无语料支撑的推演。
//    v5 改为：上卦 = 对方完整卦码（同构），场只在非人格时退化为外显一爻。
const FIELD = {
  __deprecated: 'v1 已废弃：上卦不再用「场三爻」，改用对方完整卦码，见 REL / fieldHex',
  fieldNature: () => { throw new Error('FIELD.fieldNature 已废弃(v5)：上卦=对方卦码，请用 energy(other)'); },
  demand:      () => { throw new Error('FIELD.demand 已废弃(v5)：上卦=对方卦码，请用 transmitDemand(other)'); },
  shellPolicy: () => { throw new Error('FIELD.shellPolicy 已废弃(v5)：上卦=对方卦码，请用 isShell(other)'); },
};

// ---------- 判据权重表 v1（反编译用：可观测特征 → bit）----------
// weight 正=指向1(阳) 负=指向0(阴) 0=禁用（两边都会出现，无判别力）
// level A=强证据（直接指向价值感来源） B=中（壳信号） X=禁用
const RULES = [
  { id:'r01', bit:0, w:+3, level:'A', desc:'出了问题第一反应是"我哪里没做好"，还是"谁对不起我"' },
  { id:'r02', bit:0, w:+3, level:'A', desc:'独处是充电还是耗电' },
  { id:'r03', bit:0, w:+3, level:'A', desc:'被否定后：自我怀疑 vs 急于找对方确认' },
  { id:'r04', bit:0, w:+3, level:'A', desc:'做事是否需要被看见/被认可才踏实' },
  { id:'r05', bit:0, w:+2, level:'A', desc:'自我评价的锚在自己身上还是在别人的反馈里' },
  { id:'r06', bit:0, w:-2, level:'B', desc:'冲突第一反应：直面(阳) vs 回避(阴)' },
  { id:'r07', bit:2, w:+2, level:'B', desc:'付出很多且反复讲（自我感动）→ 壳信号' },
  { id:'r08', bit:2, w:+2, level:'B', desc:'需要观众、需要被承认"我很不容易" → 壳信号' },
  { id:'r09', bit:0, w: 0, level:'X', desc:'谁做决定（禁用：两边都有）' },
  { id:'r10', bit:0, w: 0, level:'X', desc:'谁扛事（禁用：男阴的扛事可能正是壳）' },
  { id:'r11', bit:0, w: 0, level:'X', desc:'是否强势/能忍/不求助（禁用）' },
  { id:'r12', bit:0, w: 0, level:'X', desc:'使命感强弱（禁用）' },
];

// ---------- 自检 ----------
function selfTest() {
  const errs = [];
  for (const g of GUA) {
    const [e, s, x] = g.bits;
    const truth = (s ? '男' : '女') + (e ? '阳' : '阴');
    if (g.kind === '真体') {
      if (x !== e) errs.push(`${g.name} 真体应外显=能量`);
      if (g.role !== truth) errs.push(`${g.name} 真体名不符：${g.role} vs ${truth}`);
    } else {
      if (x === e) errs.push(`${g.name} 假壳应外显!=能量`);
      if (g.role !== (x ? '阳壳' : '阴壳') + truth) errs.push(`${g.name} 假壳名不符：${g.role}`);
    }
    if (!isShell(g.code) !== (g.kind === '真体')) errs.push(`${g.name} isShell 判定错`);
    if (toTrue(g.code) !== BY_ROLE[truth].code) errs.push(`${g.name} toTrue 错`);
  }
  // 已知卦变关系
  const checks = [
    ['乾错坤', inv(7) === 0], ['离错坎', inv(5) === 2], ['艮错兑', inv(4) === 3], ['震错巽', inv(1) === 6],
    ['乾综乾', rev(7) === 7], ['坤综坤', rev(0) === 0], ['离综离', rev(5) === 5], ['坎综坎', rev(2) === 2],
    ['艮综震', rev(4) === 1], ['巽综兑', rev(6) === 3],
    ['泰综否', hexRev(hex(7, 0)) === hex(0, 7)],
    ['泰名', hexName(7, 0) === '地天泰'], ['否名', hexName(0, 7) === '天地否'],
    ['剥壳归真_巽→坎', toTrue(6) === 2], ['剥壳归真_兑→乾', toTrue(3) === 7],
    ['剥壳归真_艮→坤', toTrue(4) === 0], ['剥壳归真_震→离', toTrue(1) === 5],
    ['覆壳_坤→艮', toShell(0) === 4], ['覆壳_乾→兑', toShell(7) === 3],
    ['覆壳_坎→巽', toShell(2) === 6], ['覆壳_离→震', toShell(5) === 1],
  ];
  for (const [n, ok] of checks) if (!ok) errs.push('卦变校验失败: ' + n);
  return errs;
}

// 自检补充：先天八卦次序（乾1兑2离3震4巽5坎6艮7坤8）
function selfTest2() {
  const errs = [];
  const XT = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
  XT.forEach((n, i) => {
    const g = BY_NAME[n];
    if (xianTian(g.code) !== i + 1) errs.push(`${n} 先天序应为 ${i + 1}，实为 ${xianTian(g.code)}`);
    if (weightR(g.code) !== 7 - i) errs.push(`${n} 加权值应为 ${7 - i}，实为 ${weightR(g.code)}`);
  });
  // 外显能量单调递减
  for (let i = 1; i < XT.length; i++) {
    if (weightR(BY_NAME[XT[i]].code) >= weightR(BY_NAME[XT[i - 1]].code)) errs.push(`外显能量未递减：${XT[i - 1]} → ${XT[i]}`);
  }
  // 内核只由初爻定：同初爻的卦，内核相同
  if (energy(BY_NAME['乾'].code) !== energy(BY_NAME['兑'].code)) errs.push('乾/兑 内核应同为阳');
  if (energy(BY_NAME['坤'].code) !== energy(BY_NAME['艮'].code)) errs.push('坤/艮 内核应同为阴');
  return errs;
}

// 自检补充：难度系数 + 代际传递规则
function selfTest3() {
  const errs = [];
  // 难度 = |偏离|
  const DIFF = { 乾: 0, 兑: 1, 离: 2, 震: 3, 巽: 3, 坎: 2, 艮: 1, 坤: 0 };
  for (const [n, d] of Object.entries(DIFF))
    if (difficulty(BY_NAME[n].code) !== d) errs.push(`${n} 难度应为 ${d}，实为 ${difficulty(BY_NAME[n].code)}`);
  // 同向叠加 vs 对冲：震/巽 = 3，兑/艮 = 1
  if (difficulty(BY_NAME['震'].code) <= difficulty(BY_NAME['兑'].code)) errs.push('震难度应高于兑（同向叠加 vs 对冲）');
  // R1a 方式 = 外显；R1b 要求 = 内核
  if (transmitWay(BY_NAME['艮'].code) !== 1)    errs.push('艮 方式应为阳(外显阳)');
  if (transmitDemand(BY_NAME['艮'].code) !== 0) errs.push('艮 要求应为阴(内核阴)');
  if (transmitWay(BY_NAME['坤'].code) !== 0)    errs.push('坤 方式应为阴');
  if (transmitDemand(BY_NAME['坤'].code) !== 0) errs.push('坤 要求应为阴');
  // R2 壳由要求决定
  if (inherit(BY_NAME['艮'].code, 1).effect !== '生成壳') errs.push('艮要求阴 + 阳内核 → 应生成壳');
  if (inherit(BY_NAME['乾'].code, 1).effect !== '固化内核') errs.push('乾要求阳 + 阳内核 → 应固化');
  // childFrom：⭐ 用户实际家庭数据校验（艮母+巽父+阳内核+女 → 震）
  if (childFrom(1, 0, BY_NAME['艮'].code) !== BY_NAME['震'].code) errs.push('艮母 + 阳内核 + 女 → 应为震（用户实例）');
  if (childFrom(1, 0, BY_NAME['巽'].code) !== BY_NAME['震'].code) errs.push('巽父 + 阳内核 + 女 → 应为震（用户实例）');
  if (childFrom(1, 0, BY_NAME['坤'].code) !== BY_NAME['震'].code) errs.push('坤母 + 阳内核 + 女 → 应为震');
  // 阴内核被要求显阳 → 生成**阳壳**（B100「内核阴+假阳面具=装坚强」）
  if (childFrom(0, 1, BY_NAME['乾'].code) !== BY_NAME['巽'].code) errs.push('乾父(要求阳) + 阴内核 + 男 → 应为巽(阳壳男阴)');
  // ⭐ 同一艮母、不同内核的两个女儿：阳内核→震，阴内核→坤（用户与其妹实例）
  if (childFrom(0, 0, BY_NAME['艮'].code) !== BY_NAME['坤'].code) errs.push('艮母 + 阴内核 + 女 → 应为坤（用户之妹，"全阴"）');
  if (childFrom(0, 1, BY_NAME['巽'].code) !== BY_NAME['坎'].code) errs.push('巽父(要求阴) + 阴内核 + 男 → 应为坎');
  // R3 撕裂源自父母带壳
  if (parentTear(BY_NAME['艮'].code) !== 1) errs.push('艮带壳 → 撕裂应为 1');
  if (parentTear(BY_NAME['坤'].code) !== 0) errs.push('坤真体 → 撕裂应为 0');
  if (familyTear(BY_NAME['巽'].code, BY_NAME['艮'].code) !== 2) errs.push('巽父+艮母 皆带壳 → 家庭撕裂应为 2');
  if (familyTear(BY_NAME['乾'].code, BY_NAME['坤'].code) !== 0) errs.push('乾父+坤母 皆真体 → 家庭撕裂应为 0');
  return errs;
}

// 自检补充：维度层（规训集）
function selfTest4() {
  const errs = [];
  // ⭐ 用户实例：内核阳 + 女 + 母训(阴3) + 父训(阴2) + 场训(阳2)
  const U = { kernel: 1, sexBit: 0, injs: [
    { source: '母·艮', dir: 0, strength: 3 },
    { source: '父·巽', dir: 0, strength: 2 },
    { source: '场·自强', dir: 1, strength: 2 }] };
  const u = codeFromInj(U.kernel, U.sexBit, U.injs);
  if (u.code !== BY_NAME['震'].code) errs.push(`用户实例应得震，实得 ${BY_CODE[u.code].name}`);
  if (u.balance.against !== 7 || u.balance.for_ !== 2) errs.push(`用户合力应为 7:2，实为 ${u.balance.against}:${u.balance.for_}`);
  // ⭐ 妹妹实例：内核阴 + 女 + 母训(阴3)
  const s = codeFromInj(0, 0, [{ source: '母·艮', dir: 0, strength: 3 }]);
  if (s.code !== BY_NAME['坤'].code) errs.push(`妹妹实例应得坤，实得 ${BY_CODE[s.code].name}`);
  if (s.balance.hasShell) errs.push('妹妹不应带壳（要求与内核同向 → 固化）');
  // 破壳路径：解除母训+父训后应翻转为离
  const p = shedPath(U.kernel, U.sexBit, U.injs);
  if (p.end.code !== BY_NAME['离'].code) errs.push(`破壳终点应为离，实为 ${p.end.name}`);
  if (p.steps.length !== 2) errs.push(`破壳应需 2 步（母+父），实为 ${p.steps.length}`);
  // 性别训不可解除：内核阳+女，即使所有训解除，仍需同向训 > 2 才无壳
  const bare = codeFromInj(1, 0, []);
  if (bare.code !== BY_NAME['震'].code) errs.push('内核阳+女 无外训时应仍为震（性别脚本训仍在）');
  if (bare.balance.against !== 2) errs.push('裸装反向合力应 = 性别训 2');
  // 平局 → 内核胜
  const tie = codeFromInj(1, 0, [{ source: 'x', dir: 1, strength: 2 }]);
  if (isShell(tie.code)) errs.push('平局(2:2)应判无壳 → 内核胜');
  return errs;
}

// ---------- 自检 v5：代际传递 v3（主养者 / 壳不遗传 / 两个来源 / 抱持 / 卦码可变）----------
function selfTest5() {
  const errs = [];
  const G = n => BY_NAME[n].code;
  const nm = c => BY_CODE[c].name;

  // R5'' 传递者 = 主养者：外孙女由大姨(震·内核阳)带大 → 离
  if (childFrom2(1, 0, G('震')) !== G('离')) errs.push('R5 主养者震(内核阳)+阳内核+女 → 应为离');
  if (childFrom2(1, 0, G('艮')) !== G('震')) errs.push('R5 生母艮(内核阴)+阳内核+女 → 应为震');

  // R6 壳不遗传：小舅舅巽(阳壳) → 儿子小表哥坎(无壳)
  if (childFrom2(0, 1, G('巽')) !== G('坎')) errs.push('R6 巽(内核阴)+阴内核+男 → 应为坎（壳未遗传）');

  // R7 来源B · 场：表哥 内核阴 + 男 + 场要求阳(强度3) → 巽
  const t7 = codeFromInj(0, 1, [fieldInj(1, 3, '场·当兵')]);
  if (t7.code !== G('巽')) errs.push('R7 场要求阳(3)+阴内核+男 → 应为巽，实为 ' + nm(t7.code));

  // R7 同一场对不同内核作用相反：内核阳时场不造壳
  const t7b = codeFromInj(1, 0, [fieldInj(1, 2, '场·父系业力'), { source: '母·要乖', dir: 0, strength: 3 }]);
  if (t7b.balance.for_ !== 2) errs.push('R7 场与内核同向时应计入同向合力');

  // R8 抱持 = 同向训增强器（路线B）
  const base = [{ source: '母·要乖', dir: 0, strength: 3 }, { source: '父·考虑他们', dir: 0, strength: 2 }];
  const before = codeFromInj(1, 0, base);
  if (!isShell(before.code)) errs.push('R8 基线应带壳(震)');
  const sp = strengthenPath(1, 0, base, 8);
  if (isShell(sp.end.code)) errs.push('R8 补同向力后应能剥壳');
  if (sp.end.code !== G('离')) errs.push('R8 剥壳终点应为离，实为 ' + nm(sp.end.code));
  if (holdInj(G('巽'), 2).dir !== 1) errs.push('R8 巽(外显阳)的抱持方向应为阳');

  // buildInjSet：母艮 + 父巽 + 场(阳,2)
  const set = buildInjSet({ mother: G('艮'), father: G('巽'), mStrength: 3, fStrength: 2,
                            fields: [{ dir: 1, strength: 2, source: '场·父系业力' }] });
  if (set.length !== 3) errs.push('buildInjSet 应有 3 条训，实为 ' + set.length);
  const r8 = codeFromInj(1, 0, set);
  if (r8.code !== G('震')) errs.push('buildInjSet 用户实例应为震，实为 ' + nm(r8.code));
  if (r8.balance.against !== 7 || r8.balance.for_ !== 2)
    errs.push('buildInjSet 用户合力应为 7:2，实为 ' + r8.balance.against + ':' + r8.balance.for_);

  // R9 卦码可变：离 → 震 → 离
  const tr = trajectory([{ stage: 'a', code: G('离') }, { stage: 'b', code: G('震') }, { stage: 'c', code: G('离') }]);
  if (tr[0].shell || tr[2].shell) errs.push('R9 首尾应为真体(离)');
  if (!tr[1].shell) errs.push('R9 中段应为带壳(震)');
  for (const x of tr) if (x.kernel !== 1) errs.push('R9 内核全程应为阳');
  if (!tr[1].diff.showChanged || !tr[2].diff.showChanged) errs.push('R9 两次转变都应只变外显');
  if (tr[1].diff.kernelChanged || tr[2].diff.kernelChanged) errs.push('R9 内核不应改变');

  return errs;
}

// ---------- 自检 v6：R10 溯源释放 / R11 序位投射 / 补偿符号 ----------
function selfTest6() {
  const errs = [];
  const G = n => BY_NAME[n].code;
  const nm = c => BY_CODE[c].name;

  // R10 未溯源的训不解除；指认来源后释放 → 强度归零
  const i1 = traceInj({ source: '母·要乖', dir: 0, strength: 3 });
  if (i1.traced) errs.push('R10 未填 origin 时应为未溯源');
  const i2 = traceInj({ source: '母·要乖', dir: 0, strength: 3 },
                      { from: '母亲·艮', when: '被接回父母家后' });
  if (!i2.traced) errs.push('R10 填了 from 应为已溯源');
  if (releaseInj(i2).effStrength !== 0) errs.push('R10 释放后有效强度应为 0');

  // R10 审计：未溯源条数 = 剩余课题量
  const a = audit([traceInj({ source: '母·要乖', dir: 0, strength: 3 }, { from: '母' }),
                   traceInj({ source: '未知来源', dir: 0, strength: 2 })]);
  if (a.untraced !== 1 || a.remainStrength !== 2)
    errs.push('R10 审计应剩 1 条 / 强度 2，实为 ' + a.untraced + '/' + a.remainStrength);

  // R10 释放后重算：用户实例 反向7 vs 同向2 → 释放母训(3)+父训(2) 后应剥壳
  const set0 = buildInjSet({ mother: G('艮'), father: G('巽'), mStrength: 3, fStrength: 2,
                             fields: [{ dir: 1, strength: 2, source: '场·父系业力' }] });
  const rel = afterRelease(1, 0, set0, ['母·艮(要求阴)', '父·巽(要求阴)']);
  if (rel.shell) errs.push('R10 释放双亲训后应剥壳，实为 ' + rel.name);
  if (rel.code !== G('离')) errs.push('R10 剥壳终点应为离，实为 ' + rel.name);

  // R11 序位投射：长女 → 序位要阳(1) vs 性别脚本要阴(0) → 对冲
  const ri = rankInj('ELDEST', 0, 2, '序位·长女顶门');
  if (ri.dir !== 1) errs.push('R11 长子/长女序位方向应为阳');
  if (!ri.conflict) errs.push('R11 长女应判定为对冲训');
  if (rankInj('ELDEST', 1, 2).conflict) errs.push('R11 长子不应判定为对冲');
  if (rankInj('YOUNGEST', 0, 2).conflict) errs.push('R11 幼女不应判定为对冲');

  // R11 对冲训进入规训集：与性别脚本训同向叠加于「阴」… 不，序位训是阳向，应削弱壳
  const t11 = codeFromInj(1, 0, [sexInj(0), ri]);
  if (t11.balance.for_ <= 0) errs.push('R11 序位训(阳向)应计入同向合力');

  // 补偿符号：带壳卦有指纹，真体没有
  if (compensate(G('震')).length === 0) errs.push('震应有补偿性符号指纹');
  if (compensate(G('离')).length !== 0) errs.push('离(真体)不应有泄漏指纹');

  return errs;
}

// ---------- 自检 v7：R12 场筛选 / R13 改写 / 行为指纹 ----------
function selfTest7() {
  const errs = [];
  const G = n => BY_NAME[n].code;

  // R12 场按性别筛选
  const f1 = fieldInj2(0, 3, '场·母系匮乏(金钱=死亡)', ['F']);
  if (fieldApplies(f1, 1)) errs.push('R12 母系匮乏场不应作用于男性');
  if (!fieldApplies(f1, 0)) errs.push('R12 母系匮乏场应作用于女性');
  if (!fieldApplies(fieldInj2(1, 2, '场·父系变强'), 0)) errs.push('R12 无筛选的场应作用于所有人');

  // R12 筛选后重算：母系场阴性只对用户(女)生效
  const setF = [sexInj(0), { source: '母·艮(要乖)', dir: 0, strength: 3 }, f1];
  if (codeFromInj(1, 0, setF).code !== G('震')) errs.push('R12 女性应受母系场作用，实为 ' + BY_CODE[codeFromInj(1, 0, setF).code].name);

  // R13 改写：行为保留，驱动源替换 → 决策权重归零
  const base = [{ source: '母·艮(要乖)', dir: 0, strength: 3 },
                { source: '场·母系匮乏(不配丰盛)', dir: 0, strength: 3 },
                { source: '场·父系业力(证明自己)', dir: 1, strength: 2 }];
  const before = codeFromInj(1, 0, base);
  if (!isShell(before.code)) errs.push('R13 基线应带壳');
  const rw = rewritePath(1, 0, base, ['母·艮(要乖)', '场·母系匮乏(不配丰盛)']);
  if (isShell(rw.code)) errs.push('R13 改写后应剥壳，实为 ' + rw.name);
  if (rw.code !== G('离')) errs.push('R13 改写终点应为离，实为 ' + rw.name);
  if (rw.kept.length !== 2) errs.push('R13 应保留 2 条被改写训的行为');
  // ⭐ 关键断言：改写 ≠ 删除 —— 行为还在，权重没了
  const kept = rw.injs.find(i => i.source === '场·母系匮乏(不配丰盛)');
  if (!kept || kept.strength !== 3) errs.push('R13 改写后行为强度应保留(仍节俭)');
  if (!isRewritten(kept)) errs.push('R13 改写后应标记为已改写');

  // 行为指纹
  if (matchBehavior('开灯').length === 0) errs.push('行为指纹应能按「开灯」命中');
  if (matchBehavior('薅羊毛').length === 0) errs.push('行为指纹应能按「薅羊毛」命中');

  return errs;
}

// ---------- 自检 v8：R14 动机层（假阳 / 动机壳 / 反噬 / 锚点确认）----------
function selfTest8() {
  const errs = [];

  // R14 真实阴阳由动机定：行为阳 + 动机外求 → 实质阴
  const prove = { source: '场·父系业力(证明自己)', dir: 1, strength: 3, basis: 'fear' };
  if (motiveEnergy(prove) !== 0) errs.push('R14 fear 驱动的真实阴阳应为阴(0)');
  if (motiveEnergy({ dir: 1, basis: 'choice' }) !== 1) errs.push('R14 choice 驱动应为阳(1)');

  // 两类壳
  if (shellKind(1, prove).kind !== '动机壳') errs.push('R14 阳内核+显阳行为+外求动机 → 应为动机壳');
  if (shellKind(1, { dir: 0, basis: 'choice' }).kind !== '行为壳') errs.push('R14 阳内核+显阴行为+自主动机 → 应为行为壳');
  if (shellKind(1, { dir: 0, basis: 'fear' }).kind !== '双重壳') errs.push('R14 行为+动机皆反 → 应为双重壳');
  if (shellKind(1, { dir: 1, basis: 'choice' }).kind !== '无壳') errs.push('R14 行为+动机皆对 → 应无壳');

  // 假阳判定（B100）
  if (!pseudoYang(prove)) errs.push('R14 显阳+恐惧 = 假阳');
  if (pseudoYang({ dir: 1, basis: 'choice' })) errs.push('R14 显阳+自主 不应判假阳');
  if (!pseudoYin({ dir: 0, basis: 'fear' })) errs.push('R14 显阴+恐惧 = 恐惧阴');

  // ⭐ 用户实例：阳内核，"证明自己"是假阳 → 行为对了动机不对
  const mine = [sexInj(0),
    { source: '场·父系业力(证明自己)', dir: 1, strength: 3, basis: 'fear' },
    { source: '场·江浙沪(追求财富权力)', dir: 1, strength: 2, basis: 'fear' },
    { source: '序位·长女顶门', dir: 1, strength: 2, basis: 'choice' }];
  const ret = retribution(1, mine);
  if (ret.risk !== 5) errs.push('R14 反噬风险应为 5(3+2)，实为 ' + ret.risk);
  if (ret.level !== '中') errs.push('R14 风险等级应为中，实为 ' + ret.level);
  if (ret.count !== 2) errs.push('R14 应有 2 条假阳训');

  // 改写后风险归零（用户：只做喜欢的事，不为证明）
  const after = mine.map(i => (i.basis === 'fear' ? rewriteInj(i, { basis: 'choice' }) : i));
  if (retribution(1, after).risk !== 0) errs.push('R14 改写后反噬风险应归零');

  // 动机层审计
  const am = auditMotive(1, after);
  if (am.假阳.length !== 0) errs.push('R14 改写后不应剩假阳');
  if (am.progress < 100) errs.push('R14 改写后完成度应达 100%，实为 ' + am.progress);

  return errs;
}

// ---------- 自检 v9：R15 解除的行为级验收 / 相性区分 / 三代同构 ----------
function selfTest9() {
  const errs = [];
  const G = n => BY_NAME[n].code;

  // R15 四象限
  if (!releaseCheck({ guilt: 0, care: 3 }).passing) errs.push('R15 无疚+有爱 → 应为已解除');
  if (releaseCheck({ guilt: 0, care: 0 }).passing) errs.push('R15 无疚+无爱 → 不应判为解除（疑似解离）');
  if (releaseCheck({ guilt: 2, care: 3 }).passing) errs.push('R15 有疚+有爱 → 应仍在执行');
  if (releaseCheck({ guilt: 3, care: 0 }).passing) errs.push('R15 有疚+无爱 → 不应判为解除');
  // ⭐ 用户实例：抛弃女儿，无疚，仍给富足陪伴
  const self = releaseCheck({ guilt: 0, care: 3, socialStrength: 3 });
  if (self.verdict !== '已解除') errs.push('R15 用户实例应判已解除');

  // 相 / 性
  const xx = xiangXing('抛弃', '希望她活出不一样的人生');
  if (!xx.note.includes('判')) errs.push('相性 note 缺失判据');
  if (xx.XIANG.indexOf('相') !== 0) errs.push('XIANG 定义异常');

  // 三代同构：相重复 / 性改变 → 传递中断
  const ch = lineageChain([
    { gen: '外婆', xiang: '差点送走', xiangKey: '抛弃', xing: '匮乏', basis: 'fear' },
    { gen: '母亲', xiang: '寄养不管', xiangKey: '抛弃', xing: '投射', basis: 'fear' },
    { gen: '用户', xiang: '未争抚养权', xiangKey: '抛弃', xing: '活出自己', basis: 'choice' },
  ]);
  if (!ch[1].repeated) errs.push('三代同构 第2代应判定相重复');
  if (ch[1].basisChanged) errs.push('三代同构 第2代性未变');
  if (!ch[2].repeated) errs.push('三代同构 第3代应判定相重复');
  if (!ch[2].basisChanged) errs.push('三代同构 第3代性应已改变');
  if (!ch[2].note.includes('中断')) errs.push('三代同构 第3代应判定传递中断');

  // ⭐ R5''' 决定性验证：母亲为什么是艮（主养者=大姨·震，非生母外婆）
  const mother = childFrom2(0, 0, G('震'));
  if (mother !== G('艮')) errs.push('R5 内核阴+女+主养者震 → 应为艮，实为 ' + BY_CODE[mother].name);
  const wrong = childFrom2(0, 0, G('坤'));
  if (wrong === G('艮')) errs.push('R5 按生母(坤)不应得艮 → 生母模型应失效');
  // 同一套规则解释三个人
  if (childFrom2(1, 0, G('艮')) !== G('震')) errs.push('R5 用户(内核阳+主养者艮) → 应为震');
  if (childFrom2(0, 0, G('艮')) !== G('坤')) errs.push('R5 妹妹(内核阴+主养者艮) → 应为坤');

  // R16 献祭
  if (!sacrifice({ basis: 'fear', strength: 3 }, false).isSacrifice) errs.push('R16 fear+3+无意识 → 应为献祭');
  if (sacrifice({ basis: 'fear', strength: 3 }, true).isSacrifice) errs.push('R16 已觉察 → 献祭应结束');
  if (sacrifice({ basis: 'choice', strength: 3 }, false).isSacrifice) errs.push('R16 choice 驱动不应为献祭');

  // R17 失去反应
  if (!lossReaction({ vulnerable: true, decisive: false }).type.includes('真阴')) errs.push('R17 脆弱+请求留下 → 应判真阴');
  if (!lossReaction({ vulnerable: false, decisive: true }).type.includes('阳壳')) errs.push('R17 决绝+不示弱 → 应判阳壳');

  // R18 抱持 vs 承载
  if (attachment({ seen: false, basis: 'choice' }).canShed) errs.push('R18 未被看见（承载）不应能剥壳');
  if (!attachment({ seen: true, mutual: true, basis: 'choice' }).canShed) errs.push('R18 双向抱持应能剥壳');
  if (attachment({ seen: true, mutual: false, basis: 'choice' }).canShed) errs.push('R18 单向抱持不应能剥壳');
  if (attachment({ seen: true, mutual: true, basis: 'fear' }).canShed) errs.push('R18 fear 驱动的抱持不应能剥壳');

  // R19 情绪通道
  if (affectChannel(true, 0).shell) errs.push('R19 情绪通道开 → 不应成壳（前夫·坎）');
  if (!affectChannel(false, 0).shell) errs.push('R19 情绪通道闭 → 应成壳（双生·巽）');
  if (affectInj(3).kind !== 'AFFECT') errs.push('R19 情绪禁止训应标记 kind=AFFECT');
  // 痛感差异：巽无信号，震有信号
  if (shellAwareness(G('震')).pain <= 0) errs.push('R19 震应有痛感（有信号）');
  if (shellAwareness(G('巽')).pain !== 0) errs.push('R19 巽应无痛感（无信号）→ 实际难度高于震');

  // R20 回弹
  const rl = relapse(1, 0, G('离'), '被抛弃');
  if (!rl.isTrigger) errs.push('R20 「被抛弃」应识别为触发器');
  if (rl.code !== G('震')) errs.push('R20 阳内核+女 回弹应为震，实为 ' + rl.name0);
  if (!isShell(rl.code)) errs.push('R20 回弹后应带壳');

  return errs;
}

const YY =  { GUA, BY_CODE, BY_NAME, BY_ROLE, HEX_NAMES, RULES, FIELD, REL, REL_READ, relPair, fieldHex,
  isShell, energy, sex, show, toTrue, toShell, rev, inv, hex, unhex, hexRev, hexInv, hexName,
  weightR, yangCount, rPercent, xianTian, deviation, difficulty,
  relHex, transmitWay, transmitDemand, inherit, transmitsShell, childFrom,
  parentTear, familyTear,
  SEX_STRENGTH, sexInj, balance, codeFromInj, shedPath, selfTest4, selfTest5, selfTest6,
  childFrom2, fieldInj, holdInj, buildInjSet, strengthenPath, trajectory,
  traceInj, releaseInj, audit, afterRelease, RANK, rankInj, COMPENSATE, compensate,
  fieldInj2, fieldApplies, rewriteInj, isRewritten, rewritePath, BEHAVIOR_FP, matchBehavior,
  BASIS, motiveEnergy, shellKind, pseudoYang, pseudoYin, retribution, auditMotive,
  XIANG, XING, xiangXing, releaseCheck, lineageChain, sacrifice, lossReaction, attachment, AFFECT, affectChannel, affectInj, shellAwareness, RELAPSE_TRIGGER, relapse, selfTest7, selfTest8, selfTest9 };

// ---------- 双环境导出（Node / 浏览器）----------
if (typeof module !== 'undefined' && module.exports) module.exports = YY;
if (typeof window !== 'undefined') window.YY = YY;
