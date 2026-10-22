const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const bank = require('./bank');
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.get('/qr/:room', async (req, res) => {
  // Prefer an explicitly configured public URL; otherwise honor reverse-proxy headers (Render, Railway, etc.).
  const forwardedProto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const base = (process.env.PUBLIC_URL || `${forwardedProto}://${forwardedHost}`).replace(/\/$/, '');
  const url = `${base}/?room=${encodeURIComponent(req.params.room)}`;
  try {
    const png = await QRCode.toBuffer(url, {width: 420, margin: 3, errorCorrectionLevel: 'H', color: {dark:'#151714', light:'#ffffff'}});
    res.set('Cache-Control', 'no-store'); res.type('png').send(png);
  } catch (err) { console.error('QR generation failed:', err); res.status(500).type('text').send('Could not generate QR code. Check PUBLIC_URL and server logs.'); }
});
const rooms = new Map();
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();
function publicPlayer(p) { return {id:p.id, name:p.name, score:p.score, answered:!!p.answer}; }
function leaderboard(room) { return [...room.players.values()].map(publicPlayer).sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name)); }
const ROUND_ORDER = ['easy','medium','hard'];
const ROUND_LABELS = {easy:'Easy — Casual Fan',medium:'Medium — Zombie Watcher',hard:'Hard — Winchester Regular'};
const FACTS = [
  {title:'A genre mash-up', text:'Shaun of the Dead is often described as a “rom-zom-com”: romantic comedy meets zombie horror.'},
  {title:'A very familiar corner shop', text:'Shaun’s morning walk is repeated to show how ordinary life changes as the zombie outbreak grows.'},
  {title:'The cricket bat', text:'The cricket bat becomes one of Shaun’s signature tools for dealing with zombies.'},
  {title:'The Winchester plan', text:'The pub becomes the group’s destination and the centrepiece of Shaun’s plan to survive.'},
  {title:'The fence gag', text:'The repeated garden-fence moments are a visual running gag that rewards attentive viewers.'},
  {title:'Queen on the jukebox', text:'The group fights zombies to Queen’s “Don’t Stop Me Now” in one of the film’s best-known set pieces.'},
  {title:'Simon Pegg and Edgar Wright', text:'Simon Pegg co-wrote the screenplay with director Edgar Wright.'},
  {title:'Ed’s gaming habit', text:'Ed’s video-game habit continues even after the outbreak, giving the ending a dark comic twist.'},
  {title:'A 2004 release', text:'Shaun of the Dead was released in 2004 and became a defining modern British horror-comedy.'}
];
function emitState(roomCode) {
  const r = rooms.get(roomCode); if (!r) return;
  io.to(roomCode).emit('room-state', {
    roomCode, phase:r.phase, round:r.round, roundLabel:ROUND_LABELS[r.round], roundNumber:r.roundNumber, roundTotal:3, phaseTimeLeft:r.phase==='round-results'||r.phase==='facts' ? Math.max(0, Math.ceil((r.phaseDeadline-Date.now())/1000)) : 0, fact:r.phase==='facts' ? FACTS[r.factIndex % FACTS.length] : null, factNumber:r.phase==='facts' ? (r.factIndex % FACTS.length)+1 : 0, roundScores:r.phase==='round-results' ? [...r.players.values()].map(p=>({name:p.name,score:p.score,roundScore:p.roundScore||0})).sort((a,b)=>b.roundScore-a.roundScore) : null, players:[...r.players.values()].map(publicPlayer), leaderboard:leaderboard(r),
    questionIndex:r.index, total:r.questions.length, question:r.phase==='question' || r.phase==='reveal' ? r.questions[r.index] && {c:r.questions[r.index].c,q:r.questions[r.index].q,a:r.questions[r.index].a} : null,
    timeLeft:r.phase==='question' ? Math.max(0, Math.ceil((r.deadline-Date.now())/1000)) : 0,
    reveal:r.phase==='reveal' ? {correctAnswer:r.questions[r.index].a[r.questions[r.index].k], correctNames:[...r.players.values()].filter(p=>p.answer && p.answer.choice===r.questions[r.index].k).sort((a,b)=>a.answer.elapsed-b.answer.elapsed).map(p=>({name:p.name,points:p.lastPoints||0,elapsed:p.answer.elapsed})), explanation:r.questions[r.index].e} : null,
    winner:r.phase==='finished' ? leaderboard(r)[0] || null : null
  });
}
function clearRoundTimer(r) { if (r.timer) clearTimeout(r.timer); if (r.tick) clearInterval(r.tick); if (r.phaseTimer) clearTimeout(r.phaseTimer); r.timer=null; r.tick=null; r.phaseTimer=null; }
function reveal(roomCode) {
  const r=rooms.get(roomCode); if(!r || r.phase!=='question') return;
  clearRoundTimer(r); r.phase='reveal';
  const q=r.questions[r.index];
  for(const p of r.players.values()) {
    p.lastPoints=0;
    if(p.answer && p.answer.choice===q.k) {
      // 1000 base points plus up to 500 for speed; fastest correct answer earns the largest bonus.
      const bonus=Math.max(0, Math.round(500*(1-p.answer.elapsed/(r.seconds*1000))));
      p.lastPoints=1000+bonus; p.score+=p.lastPoints; p.roundScore=(p.roundScore||0)+p.lastPoints;
    }
  }
  emitState(roomCode);
}
io.on('connection', socket => {
  socket.on('create-room', ({difficulty='easy', seconds=15}={}) => {
    let roomCode; do {roomCode=code();} while(rooms.has(roomCode));
    const r={hostId:socket.id,players:new Map(),questions:[],index:0,round:'easy',roundNumber:0,seconds:Number(seconds)===30?30:15,phase:'lobby',timer:null,deadline:0,phaseDeadline:0,factIndex:0};
    rooms.set(roomCode,r); socket.join(roomCode); socket.data.roomCode=roomCode; socket.data.role='host';
    socket.emit('room-created',{roomCode,joinUrl:`${(process.env.PUBLIC_URL || '').replace(/\/$/,'')}/?room=${roomCode}`}); emitState(roomCode);
  });
  socket.on('join-room', ({roomCode,name}) => {
    roomCode=String(roomCode||'').trim().toUpperCase(); name=String(name||'').trim().slice(0,24);
    const r=rooms.get(roomCode);
    if(!r) return socket.emit('join-error','Room not found. Ask the host to create a new game.');
    if(!name) return socket.emit('join-error','Please enter a name.');
    if(r.phase!=='lobby') return socket.emit('join-error','This game has already started. Ask the host if you can join next round.');
    const duplicate=[...r.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase());
    if(duplicate) return socket.emit('join-error','That name is already in use. Try adding an initial.');
    r.players.set(socket.id,{id:socket.id,name,score:0,answer:null,lastPoints:0}); socket.join(roomCode); socket.data.roomCode=roomCode; socket.data.role='player';
    socket.emit('joined',{roomCode,name}); emitState(roomCode);
  });
  socket.on('start-game', () => {
    const roomCode=socket.data.roomCode, r=rooms.get(roomCode);
    if(!r || r.hostId!==socket.id || r.phase!=='lobby') return;
    if(!r.players.size) return socket.emit('host-error','At least one player must join before starting.');
    r.round='easy';r.roundNumber=0;r.index=0;for(const p of r.players.values()){p.score=0;p.roundScore=0;}loadRound(roomCode);
  });
  socket.on('submit-answer', ({choice}={}) => {
    const roomCode=socket.data.roomCode, r=rooms.get(roomCode), p=r && r.players.get(socket.id);
    if(!r || !p || r.phase!=='question' || p.answer) return;
    const n=Number(choice); if(!Number.isInteger(n)||n<0||n>3) return;
    p.answer={choice:n,elapsed:Math.max(0,Date.now()-r.questionStarted)};
    socket.emit('answer-received'); emitState(roomCode);
    if([...r.players.values()].every(x=>x.answer)) reveal(roomCode);
  });
  socket.on('reveal-answer', () => { const c=socket.data.roomCode,r=rooms.get(c); if(r&&r.hostId===socket.id) reveal(c); });
  socket.on('next-question', () => {
    const c=socket.data.roomCode,r=rooms.get(c); if(!r||r.hostId!==socket.id||r.phase!=='reveal') return;
    if(r.index>=r.questions.length-1){showRoundResults(c);} else {r.index++;startQuestion(c);}
  });
  socket.on('disconnect', () => {
    const c=socket.data.roomCode,r=rooms.get(c); if(!r)return;
    if(r.players.has(socket.id)){r.players.delete(socket.id);emitState(c);}
    if(r.hostId===socket.id){clearRoundTimer(r);io.to(c).emit('host-disconnected');rooms.delete(c);}
  });
});
function loadRound(c){const r=rooms.get(c);if(!r)return;r.questions=[...(bank[r.round]||bank.easy)].sort(()=>Math.random()-.5);r.index=0;for(const p of r.players.values())p.roundScore=0;startQuestion(c);}
function showRoundResults(c){const r=rooms.get(c);if(!r)return;clearRoundTimer(r);r.phase='round-results';r.phaseDeadline=Date.now()+8000;emitState(c);r.phaseTimer=setTimeout(()=>{if(r.round==='hard'){r.phase='finished';emitState(c);}else startFacts(c);},8000);}
function startFacts(c){const r=rooms.get(c);if(!r)return;clearRoundTimer(r);r.phase='facts';r.phaseDeadline=Date.now()+60000;r.factIndex=0;emitState(c);r.tick=setInterval(()=>{if(r.phase!=='facts')return;const elapsed=60000-Math.max(0,r.phaseDeadline-Date.now());r.factIndex=Math.floor(elapsed/20000);emitState(c);},1000);r.phaseTimer=setTimeout(()=>{clearRoundTimer(r);const next=ROUND_ORDER[r.roundNumber+1];if(!next){r.phase='finished';emitState(c);return;}r.round=next;r.roundNumber++;loadRound(c);},60000);}
function startQuestion(c){const r=rooms.get(c);if(!r)return;clearRoundTimer(r);r.phase='question';r.questionStarted=Date.now();r.deadline=Date.now()+r.seconds*1000;for(const p of r.players.values()){p.answer=null;p.lastPoints=0;}r.timer=setTimeout(()=>reveal(c),r.seconds*1000);r.tick=setInterval(()=>{if(r.phase==='question')emitState(c);},1000);emitState(c);}
server.listen(PORT,()=>console.log(`BLKROSE Trivia running on port ${PORT}`));
