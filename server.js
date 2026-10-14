const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.get('/api/join-info', async (_req, res) => {
  const base = process.env.PUBLIC_URL || `http://${getLanAddress()}:${PORT}`;
  const url = new URL(base);
  url.searchParams.delete('host');
  url.searchParams.set('room', room.code);
  const host = url.toString();
  res.json({ url: host, qr: await QRCode.toDataURL(host) });
});
function getLanAddress() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) for (const net of entries || []) if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}
const STARTING_CREDITS = 1000;
const SUBMISSION_COST = 150;
const room = {
  code: 'AIRBUS', phase: 'lobby', round: 0, players: new Map(), prompt: null,
  investments: new Map(), votes: new Map(), debateVotes: new Map(), result: null,
  history: [], timer: null, endsAt: null, submissions: [], customQueue: [], nextPrompt: null, champion: null,
  reactions: [], reactionCooldowns: new Map()
};
const prompts = [
  'People who clap when a plane lands are overhated.',
  'Every meeting could be replaced by one well-written paragraph.',
  'Replying \u201cNoted.\u201d is inherently passive-aggressive.',
  'Being five minutes early is just being late with extra steps.',
  'The person who says \u201cquick question\u201d owes everyone an apology.',
  'Group chats should automatically archive after 48 hours of silence.',
  'Airplane mode should also silence people who say \u201clet\u2019s circle back\u201d.',
  'A calendar invite without an agenda is a tiny act of violence.',
  'The best part of a work trip is cancelling a meeting in a different city.',
  '\u201cCan everyone see my screen?\u201d should count as a meeting agenda item.'
];
const publicPlayer = p => ({ id: p.id, name: p.name, avatar: p.avatar, credits: p.credits, connected: p.connected });
function odds() {
  let agree = 0, disagree = 0;
  for (const inv of room.investments.values()) {
    if (inv.side === 'agree') agree += inv.amount;
    else disagree += inv.amount;
  }
  const total = agree + disagree;
  const multiplier = pool => pool > 0 ? Math.min(3, Math.max(1.05, 1 + ((total - pool) / pool) * 0.5)) : (total > 0 ? 3 : 1.5);
  return { agreePool: agree, disagreePool: disagree, totalPool: total, agreeMultiplier: Number(multiplier(agree).toFixed(2)), disagreeMultiplier: Number(multiplier(disagree).toFixed(2)) };
}
function emitState() {
  io.emit('state', {
    code: room.code, phase: room.phase, round: room.round,
    players: [...room.players.values()].map(publicPlayer), prompt: room.prompt,
    endsAt: room.endsAt, result: room.result, history: room.history,
    investmentCount: room.investments.size, voteCount: room.votes.size,
    debateVoteCount: room.debateVotes.size, odds: odds(), champion: room.champion, nextPrompt: room.nextPrompt,
    reactions: room.reactions, queue: room.customQueue,
    submissionCost: SUBMISSION_COST,
    // Only anonymous text/status is broadcast. Author IDs never leave the server.
    submissions: room.submissions.map(s => ({ id: s.id, text: s.text, status: s.status }))
  });
}
function privateState(socket) {
  const p = room.players.get(socket.data.playerId); if (!p) return;
  socket.emit('private-state', {
    player: publicPlayer(p), investment: room.investments.get(p.id) || null,
    vote: room.votes.get(p.id) || null, debateVote: room.debateVotes.get(p.id) || null
  });
}
function fail(socket, message) { socket.emit('notice', { message }); }
function startTimer(seconds, onEnd) {
  clearTimeout(room.timer); room.endsAt = Date.now() + seconds * 1000; emitState();
  room.timer = setTimeout(onEnd, seconds * 1000);
}
function beginInvestment(prompt) {
  clearTimeout(room.timer); room.round += 1; room.prompt = prompt;
  room.phase = 'market'; room.investments.clear(); room.votes.clear(); room.debateVotes.clear(); room.result = null; room.champion = null;
  room.nextPrompt = null;
  for (const client of io.sockets.sockets.values()) privateState(client);
  room.reactions = []; room.reactionCooldowns.clear(); startTimer(120, closeMarket);
}
function closeMarket() {
  if (room.phase !== 'market') return;
  clearTimeout(room.timer); room.phase = 'debate'; room.reactions = []; startTimer(180, openVote);
}
function openVote() { if (room.phase !== 'debate') return; room.phase = 'vote'; room.reactions = []; startTimer(60, resolveRound); }
function resolveRound() {
  if (room.phase !== 'vote') return;
  clearTimeout(room.timer);
  const agree = [...room.votes.values()].filter(v => v === 'agree').length;
  const disagree = [...room.votes.values()].filter(v => v === 'disagree').length;
  const winner = agree === disagree ? 'tie' : agree > disagree ? 'agree' : 'disagree';
  const marketOdds = odds(); const payouts = [];
  for (const [id, inv] of room.investments.entries()) {
    const player = room.players.get(id); if (!player) continue;
    let returned = 0, profit = 0;
    if (winner === 'tie') { returned = inv.amount; profit = 0; }
    else if (inv.side === winner) {
      const multiplier = inv.side === 'agree' ? marketOdds.agreeMultiplier : marketOdds.disagreeMultiplier;
      returned = Math.round(inv.amount * multiplier);
      profit = returned - inv.amount;
    }
    player.credits += returned;
    payouts.push({ id, name: player.name, side: inv.side, amount: inv.amount, multiplier: inv.side === 'agree' ? marketOdds.agreeMultiplier : marketOdds.disagreeMultiplier, returned, profit, credits: player.credits });
  }
  room.result = { agree, disagree, winner, debateVotes: { agree: [...room.debateVotes.values()].filter(v => v === 'agree').length, disagree: [...room.debateVotes.values()].filter(v => v === 'disagree').length }, predictions: { agree: [...room.investments.values()].filter(x => x.side === 'agree').length, disagree: [...room.investments.values()].filter(x => x.side === 'disagree').length }, payouts, voteTotal: agree + disagree, odds: marketOdds };
  room.history.unshift({ round: room.round, prompt: room.prompt, ...room.result });
  room.phase = 'results'; room.endsAt = null; emitState();
}
function avatarIsSafe(avatar) { return typeof avatar === 'string' && avatar.length <= 180000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar); }
function cleanTake(text) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240); }
function sendPrivateStates() { for (const client of io.sockets.sockets.values()) privateState(client); }
function responseText(response) {
  if (response.output_text) return response.output_text;
  return (response.output || []).flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('\n');
}

io.on('connection', socket => {
  socket.emit('state', { code: room.code, phase: room.phase, round: room.round, players: [...room.players.values()].map(publicPlayer), prompt: room.prompt, nextPrompt: room.nextPrompt, endsAt: room.endsAt, result: room.result, history: room.history, investmentCount: room.investments.size, voteCount: room.votes.size, debateVoteCount: room.debateVotes.size, odds: odds(), champion: room.champion, submissionCost: SUBMISSION_COST, reactions: room.reactions, queue: room.customQueue, submissions: room.submissions.map(s => ({ id: s.id, text: s.text, status: s.status })) });
  function restorePlayer(player) {
    if (!player) return false;
    player.connected = true;
    socket.data.playerId = player.id;
    socket.emit('joined', { id: player.id, name: player.name, credits: player.credits, resumed: true });
    emitState();
    privateState(socket);
    return true;
  }
  socket.on('resume-player', token => {
    token = String(token || '').slice(0, 100);
    const player = [...room.players.values()].find(p => p.sessionToken === token);
    if (!restorePlayer(player)) socket.emit('player-session-lost');
  });
  socket.on('join', ({ name, code, avatar, sessionToken }) => {
    if (String(code || '').trim().toUpperCase() !== room.code) return fail(socket, 'That room code is not correct.');
    name = String(name || '').trim().slice(0, 20);
    if (!name) return fail(socket, 'Enter a nickname first.');
    sessionToken = String(sessionToken || '').slice(0, 100);
    const returningPlayer = sessionToken && [...room.players.values()].find(p => p.sessionToken === sessionToken);
    if (returningPlayer) return restorePlayer(returningPlayer);
    if (room.phase !== 'lobby' && !socket.data.playerId) return fail(socket, 'This game has already started. Ask the host to reset the lobby.');
    const existing = [...room.players.values()].find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) return fail(socket, 'That nickname is already taken. Try another one.');
    if (avatar && !avatarIsSafe(avatar)) return fail(socket, 'Please choose a valid image under 1 MB.');
    const id = socket.id;
    const player = { id, name, avatar: avatar || '', credits: STARTING_CREDITS, connected: true, sessionToken };
    room.players.set(id, player); socket.data.playerId = id;
    socket.emit('joined', { id, name, credits: STARTING_CREDITS }); emitState(); privateState(socket);
  });
  socket.on('invest', ({ side, amount }) => {
    const p = room.players.get(socket.data.playerId);
    if (!p || room.phase !== 'market') return fail(socket, 'The market is not open.');
    if (room.investments.has(p.id)) return fail(socket, 'Your investment is already locked for this round.');
    amount = Number(amount);
    if (!['agree', 'disagree'].includes(side) || !Number.isInteger(amount) || amount < 100 || amount > 500 || amount > p.credits) return fail(socket, 'Choose a side and invest 100 to 500 CP.');
    p.credits -= amount;
    room.investments.set(p.id, { side, amount });
    privateState(socket); emitState();
  });
  socket.on('vote', side => {
    const p = room.players.get(socket.data.playerId);
    if (!p || room.phase !== 'vote') return fail(socket, 'Voting is not open.');
    if (room.votes.has(p.id)) return fail(socket, 'Your vote is already locked.');
    if (!['agree', 'disagree'].includes(side)) return;
    room.votes.set(p.id, side); privateState(socket); emitState();
  });
  socket.on('debate-vote', side => {
    const p = room.players.get(socket.data.playerId);
    if (!p || room.phase !== 'debate') return fail(socket, 'Debate voting is closed.');
    if (room.debateVotes.has(p.id)) return fail(socket, 'You already submitted your debate vote.');
    if (!['agree', 'disagree'].includes(side)) return;
    room.debateVotes.set(p.id, side); privateState(socket); emitState();
  });
  socket.on('reaction', emoji => {
    const p = room.players.get(socket.data.playerId);
    if (!p || room.phase !== 'debate') return;
    if (!['🔥', '👏', '😂', '🤔'].includes(emoji)) return;
    const now = Date.now(), last = room.reactionCooldowns.get(p.id) || 0;
    if (now - last < 2000) return;
    room.reactionCooldowns.set(p.id, now);
    room.reactions = [...room.reactions, { emoji, name: p.name, at: now }].slice(-20);
    emitState();
  });
  socket.on('submit-take', text => {
    const p = room.players.get(socket.data.playerId);
    if (!p) return fail(socket, 'Join the room first.');
    if (room.phase !== 'lobby' && room.phase !== 'results') return fail(socket, 'Submit a hot take between rounds.');
    text = cleanTake(text);
    if (text.length < 12) return fail(socket, 'Your hot take needs at least 12 characters.');
    if (p.credits < SUBMISSION_COST) return fail(socket, `You need ${SUBMISSION_COST} CP to submit a hot take.`);
    if (room.submissions.some(s => s.text.toLowerCase() === text.toLowerCase() && s.status !== 'rejected')) return fail(socket, 'That hot take has already been submitted.');
    p.credits -= SUBMISSION_COST;
    room.submissions.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, status: 'pending', submittedBy: p.id });
    socket.emit('notice', { message: `Hot take submitted anonymously. ${SUBMISSION_COST} CP spent.` });
    socket.emit('take-submitted'); privateState(socket); emitState();
  });
  socket.on('host-action', async ({ action, prompt }) => {
    if (socket.data.host !== true) return fail(socket, 'Only the host dashboard can control rounds.');
    if (action === 'start') {
      if (room.phase !== 'lobby' && room.phase !== 'results') return fail(socket, 'Finish the current round first.');
      let chosen = cleanTake(prompt) || room.nextPrompt;
      if (!chosen) {
        const queued = room.customQueue.shift();
        chosen = queued || prompts[(room.round) % prompts.length];
      }
      beginInvestment(chosen);
    } else if (action === 'close-market') { if (room.phase !== 'market') return fail(socket, 'The market is not open.'); closeMarket(); }
    else if (action === 'open-vote') { if (room.phase !== 'debate') return fail(socket, 'Start the debate before opening final voting.'); openVote(); }
    else if (action === 'resolve') resolveRound();
    else if (action === 'select-take') {
      const submission = room.submissions.find(s => s.id === prompt?.id && s.status === 'approved');
      if (!submission) return fail(socket, 'That approved take is no longer available.');
      room.nextPrompt = submission.text;
      room.customQueue = room.customQueue.filter(text => text !== submission.text);
      emitState();
    } else if (action === 'queue-edit') {
      const sub = room.submissions.find(s => s.id === prompt?.id && s.status === 'approved');
      const text = cleanTake(prompt?.text);
      if (!sub || text.length < 12) return fail(socket, 'Enter an edited take with at least 12 characters.');
      const previous = sub.text; sub.text = text;
      room.customQueue = room.customQueue.map(item => item === previous ? text : item);
      emitState();
    } else if (action === 'queue-add') {
      const sub = room.submissions.find(s => s.id === prompt?.id && s.status === 'approved');
      if (!sub) return fail(socket, 'That approved take is no longer available.');
      if (!room.customQueue.includes(sub.text)) room.customQueue.push(sub.text);
      emitState();
    } else if (action === 'queue-move' || action === 'queue-skip') {
      const sub = room.submissions.find(s => s.id === prompt?.id && s.status === 'approved');
      const index = sub ? room.customQueue.indexOf(sub.text) : -1;
      if (index < 0) return fail(socket, 'That take is not in the queue.');
      if (action === 'queue-skip') room.customQueue.splice(index, 1);
      else {
        const target = Math.max(0, Math.min(room.customQueue.length - 1, index + Number(prompt.direction || 0)));
        [room.customQueue[index], room.customQueue[target]] = [room.customQueue[target], room.customQueue[index]];
      }
      emitState();
    } else if (action === 'generate-takes') {
      if (!process.env.OPENAI_API_KEY) return fail(socket, 'Add OPENAI_API_KEY to the Render service to turn on the chili bot.');
      socket.emit('take-suggestions-loading');
      try {
        const recent = [...room.history.slice(0, 8).map(item => item.prompt), room.prompt, ...room.submissions.map(item => item.text)].filter(Boolean).join('\n- ');
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            model: OPENAI_MODEL,
            instructions: 'Write exactly five short, original, debate-worthy hot takes for a lighthearted workplace team-bonding game. Make them funny, specific, and easy to vote agree or disagree on. Keep them workplace appropriate; do not target protected groups, individuals, or include politics or explicit content. Return only five takes, one per line, with no numbering or explanation.',
            input: `Avoid repeating or closely paraphrasing these previous prompts and submissions:\n- ${recent || 'None yet.'}`,
            max_output_tokens: 300
          })
        });
        const data = await response.json();
        if (!response.ok) {
          console.error('Hot-take assistant request failed:', response.status, data.error?.message || 'OpenAI API error');
          return fail(socket, 'The chili bot could not make suggestions. Check the OpenAI API key and billing settings.');
        }
        const suggestions = responseText(data).split('\n').map(line => cleanTake(line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').replace(/^["'“”]+|["'“”]+$/g, ''))).filter((take, index, all) => take.length >= 12 && all.findIndex(other => other.toLowerCase() === take.toLowerCase()) === index).slice(0, 5);
        if (!suggestions.length) return fail(socket, 'The chili bot returned no usable takes. Try again.');
        socket.emit('take-suggestions', suggestions);
      } catch (error) {
        console.error('Hot-take assistant request failed:', error.message);
        fail(socket, 'The chili bot is unavailable right now. Try again in a moment.');
      }
    }
    else if (action === 'review-take') {
      const sub = room.submissions.find(s => s.id === prompt?.id);
      if (!sub || sub.status !== 'pending') return fail(socket, 'That submission is no longer pending.');
      sub.status = prompt.approve ? 'approved' : 'rejected';
      if (prompt.approve) room.customQueue.push(sub.text);
      emitState();
    } else if (action === 'champion') {
      if (!room.players.size) return fail(socket, 'No players to crown yet.');
      const winner = [...room.players.values()].sort((a, b) => b.credits - a.credits)[0];
      room.champion = { name: winner.name, avatar: winner.avatar, credits: winner.credits };
      emitState();
    } else if (action === 'hide-champion') { room.champion = null; emitState(); }
    else if (action === 'reset') {
      clearTimeout(room.timer); room.phase = 'lobby'; room.round = 0; room.prompt = null; room.endsAt = null; room.investments.clear(); room.votes.clear(); room.debateVotes.clear(); room.result = null; room.history = []; room.submissions = []; room.customQueue = []; room.nextPrompt = null; room.champion = null; room.reactions = []; room.reactionCooldowns.clear();
      for (const p of room.players.values()) p.credits = STARTING_CREDITS;
      emitState(); sendPrivateStates();
    }
  });
  socket.on('host-auth', secret => {
    if (String(secret) !== (process.env.HOST_PIN || '2004')) return fail(socket, 'Incorrect host PIN. Default demo PIN is 2004; set HOST_PIN to change it.');
    socket.data.host = true; socket.emit('host-ready', { ok: true });
  });
  socket.on('disconnect', () => { const p = room.players.get(socket.data.playerId); if (p) { p.connected = false; emitState(); } });
});
server.listen(PORT, '0.0.0.0', () => console.log(`Hot Takes Exchange running on http://localhost:${PORT}`));
