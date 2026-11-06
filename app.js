(function () {
  'use strict';

  var MIN_BPM = 10, MAX_BPM = 120, MIN_TARGET = 1, MAX_TARGET = 999;
  var PREP_SECONDS = 3;
  var KEY_BPM = 'mettronum.last-bpm';
  var KEY_RHYTHMS = 'mettronum.rhythms';

  var app = document.getElementById('app');
  var stage = document.getElementById('stage');
  var stageLabel = document.getElementById('stage-label');
  var countEl = document.getElementById('count');
  var goalEl = document.getElementById('goal');
  var messageEl = document.getElementById('message');
  var errorEl = document.getElementById('settings-error');
  var targetInput = document.getElementById('target-input');
  var bpmInput = document.getElementById('bpm-input');
  var mainBtn = document.getElementById('main-btn');
  var resetBtn = document.getElementById('reset-btn');
  var armEl = document.getElementById('arm');
  var stepBtns = document.querySelectorAll('.step');
  var navBtn = document.getElementById('nav-btn');
  var titleEl = document.getElementById('title');
  var mainOnly = document.querySelectorAll('.main-only');
  var mypage = document.getElementById('mypage');
  var saveOpenBtn = document.getElementById('save-open-btn');
  var saveForm = document.getElementById('save-form');
  var saveCancelBtn = document.getElementById('save-cancel-btn');
  var rhythmName = document.getElementById('rhythm-name');
  var saveNote = document.getElementById('save-note');
  var rhythmList = document.getElementById('rhythm-list');
  var rhythmEmpty = document.getElementById('rhythm-empty');
  var rhythmHint = document.getElementById('rhythm-hint');
  var minusBtn = document.getElementById('minus-btn');
  var plusBtn = document.getElementById('plus-btn');

  // phase: idle | countdown | running | paused | done
  var state = { phase: 'idle', count: 0, target: 12, bpm: 30, prep: 0 };
  var timers = [];
  var audioCtx = null;
  var swingSide = 'left';
  var view = 'main'; // main | mypage
  var rhythms = [];

  // ---- 입력 검증 ----
  function parseIntStrict(text, min, max) {
    var s = String(text).trim();
    if (!/^\d+$/.test(s)) return null;
    var n = parseInt(s, 10);
    return n >= min && n <= max ? n : null;
  }

  function validateSettings() {
    var target = parseIntStrict(targetInput.value, MIN_TARGET, MAX_TARGET);
    var bpm = parseIntStrict(bpmInput.value, MIN_BPM, MAX_BPM);
    var msgs = [];
    if (target === null) msgs.push('목표 코 수는 ' + MIN_TARGET + '~' + MAX_TARGET + ' 사이의 정수로 입력해 주세요.');
    if (bpm === null) msgs.push('분당 박 수는 ' + MIN_BPM + '~' + MAX_BPM + ' 사이의 정수로 입력해 주세요.');
    errorEl.textContent = msgs.join(' ');
    errorEl.hidden = msgs.length === 0;
    return msgs.length === 0 ? { target: target, bpm: bpm } : null;
  }

  // ---- 소리 ----
  function ensureAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function beep() {
    if (!audioCtx) return;
    var t = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  // 목표 도달 알림음: 음이 올라가는 3음 "뾰로롱♪". delay초 뒤에 시작한다.
  var chimeNodes = [];
  function chime(delay) {
    if (!audioCtx) return;
    var notes = [1046.5, 1318.5, 1568.0]; // 도, 미, 솔 (높은 옥타브)
    var start = audioCtx.currentTime + delay;
    notes.forEach(function (freq, i) {
      var t = start + i * 0.11;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      var len = i === notes.length - 1 ? 0.35 : 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + len + 0.02);
      chimeNodes.push(osc);
    });
  }

  function stopChime() {
    chimeNodes.forEach(function (osc) { try { osc.stop(); } catch (e) {} });
    chimeNodes = [];
  }

  function swing() {
    var seconds = Math.min(60 / state.bpm, 0.6) * 0.9;
    armEl.style.setProperty('--swing', seconds + 's');
    swingSide = swingSide === 'left' ? 'right' : 'left';
    armEl.setAttribute('class', 'arm ' + swingSide);
  }

  function centerArm() {
    armEl.setAttribute('class', 'arm');
  }

  function flash() {
    stage.classList.remove('beat');
    void stage.offsetWidth; // 애니메이션 재시작
    stage.classList.add('beat');
  }

  // ---- 타이머 ----
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  function scheduleAt(time, fn) {
    timers.push(setTimeout(fn, Math.max(0, time - performance.now())));
  }

  // ---- 화면 ----
  function render() {
    var s = state;
    app.dataset.phase = s.phase;
    countEl.textContent = s.phase === 'countdown' ? s.prep : s.count;
    stageLabel.textContent = s.phase === 'countdown' ? '준비' : '';
    goalEl.textContent = '/ ' + s.target + '코';

    targetInput.disabled = s.phase !== 'idle';
    bpmInput.disabled = !(s.phase === 'idle' || s.phase === 'paused');

    mainBtn.textContent =
      s.phase === 'idle' ? '▶  시작' :
      s.phase === 'paused' ? '▶  재개' :
      s.phase === 'done' ? '완료' : '❚❚  일시정지';
    mainBtn.disabled = false; // 완료 상태에서는 '완료' 버튼으로 다음 단을 준비한다

    updateSteppers();
    if (view === 'mypage') renderRhythms();

    var paused = s.phase === 'paused';
    minusBtn.disabled = !paused || s.count <= 0;
    plusBtn.disabled = !paused;

    if (s.phase === 'done') {
      messageEl.textContent = '목표 코 수에 도달했어요. 실제 코 수를 확인해 주세요.';
    } else if (s.phase === 'paused') {
      messageEl.textContent = '실제로 뜬 코 수에 맞춰 숫자를 조정한 뒤 재개하세요.';
    } else {
      messageEl.textContent = '';
    }
  }

  // ---- 설정 스테퍼 (속도, 목표 코 수) ----
  var LIMITS = { 'bpm-input': [MIN_BPM, MAX_BPM], 'target-input': [MIN_TARGET, MAX_TARGET] };

  function updateSteppers() {
    stepBtns.forEach(function (btn) {
      var editable = btn.dataset.input === 'bpm-input'
        ? (state.phase === 'idle' || state.phase === 'paused')
        : state.phase === 'idle';
      var input = document.getElementById(btn.dataset.input);
      var lim = LIMITS[btn.dataset.input];
      var n = parseIntStrict(input.value, lim[0], lim[1]);
      var dir = parseInt(btn.dataset.dir, 10);
      var atLimit = n !== null && ((dir < 0 && n <= lim[0]) || (dir > 0 && n >= lim[1]));
      btn.disabled = !editable || atLimit;
    });
  }

  function stepInput(btn) {
    var input = document.getElementById(btn.dataset.input);
    var lim = LIMITS[btn.dataset.input];
    var dir = parseInt(btn.dataset.dir, 10);
    var n = parseIntStrict(input.value, lim[0], lim[1]);
    if (n === null) n = btn.dataset.input === 'bpm-input' ? state.bpm : state.target;
    n = Math.max(lim[0], Math.min(lim[1], n + dir));
    input.value = n;
    onSettingsInput();
    return !btn.disabled;
  }

  stepBtns.forEach(function (btn) {
    var delay = null, repeat = null;
    function stop() { clearTimeout(delay); clearInterval(repeat); }
    btn.addEventListener('pointerdown', function (e) {
      if (btn.disabled) return;
      e.preventDefault();
      stepInput(btn);
      delay = setTimeout(function () {
        repeat = setInterval(function () {
          if (btn.disabled) { stop(); return; }
          stepInput(btn);
        }, 70);
      }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, stop); });
    btn.addEventListener('click', function (e) {
      if (e.detail === 0 && !btn.disabled) stepInput(btn); // 키보드 조작
    });
  });

  // ---- 진행 ----
  // chimeDelay: 완료음을 몇 초 뒤에 낼지(초). 완료음이 필요 없으면 null.
  function finish(chimeDelay) {
    clearTimers();
    state.phase = 'done';
    render();
    if (chimeDelay !== null && chimeDelay !== undefined) chime(chimeDelay);
  }

  function beat() {
    state.count += 1;
    beep();
    flash();
    swing();
    if (state.count >= state.target) {
      finish(0.14); // 마지막 박자음(0.1초)이 끝난 직후
    } else {
      render();
    }
  }

  function begin() {
    clearTimers();
    ensureAudio();
    var interval = 60000 / state.bpm;
    var t0 = performance.now();
    state.phase = 'countdown';
    for (var i = 0; i < PREP_SECONDS; i++) {
      (function (n) {
        scheduleAt(t0 + n * 1000, function () {
          state.prep = PREP_SECONDS - n;
          render();
        });
      })(i);
    }
    var firstBeat = t0 + PREP_SECONDS * 1000;
    var next = firstBeat;
    function tick() {
      beat();
      if (state.phase === 'running') {
        next += interval;
        scheduleAt(next, tick);
      }
    }
    scheduleAt(firstBeat, function () {
      state.phase = 'running';
      tick();
    });
    state.prep = PREP_SECONDS;
    render();
  }

  function pause() {
    clearTimers();
    state.phase = state.count > 0 ? 'paused' : 'idle';
    render();
  }

  // 완료: 코 수만 0으로 돌리고 대기 상태로. 목표 코 수와 BPM은 유지한다.
  function completeRow() {
    clearTimers();
    state.phase = 'idle';
    state.count = 0;
    state.prep = 0;
    centerArm();
    render();
  }

  function reset() {
    clearTimers();
    stopChime();
    state.phase = 'idle';
    state.count = 0;
    state.prep = 0;
    centerArm();
    render();
  }

  mainBtn.addEventListener('click', function () {
    var p = state.phase;
    if (p === 'idle') {
      var v = validateSettings();
      if (!v) return;
      state.target = v.target;
      state.bpm = v.bpm;
      state.count = 0;
      begin();
    } else if (p === 'paused') {
      var pv = validateSettings();
      if (!pv) return;
      state.bpm = pv.bpm;
      begin();
    } else if (p === 'countdown' || p === 'running') {
      pause();
    } else if (p === 'done') {
      completeRow();
    }
  });

  resetBtn.addEventListener('click', reset);

  minusBtn.addEventListener('click', function () {
    if (state.phase !== 'paused' || state.count <= 0) return;
    state.count -= 1;
    render();
  });

  plusBtn.addEventListener('click', function () {
    if (state.phase !== 'paused') return;
    state.count += 1;
    if (state.count >= state.target) {
      state.count = state.target;
      finish(0); // 추가 박자 없이 완료음만
    } else {
      render();
    }
  });

  function onSettingsInput() {
    var v = validateSettings();
    updateSteppers();
    if (!v) return;
    if (state.phase === 'idle' || state.phase === 'paused') storeSet(KEY_BPM, String(v.bpm));
    if (state.phase === 'idle') {
      state.target = v.target;
      state.bpm = v.bpm;
      render();
    } else if (state.phase === 'paused') {
      state.bpm = v.bpm; // 일시정지 중에는 속도만 바꾼다. 코 수와 목표는 유지.
      render();
    }
  }
  targetInput.addEventListener('input', onSettingsInput);
  bpmInput.addEventListener('input', onSettingsInput);

  // ---- 브라우저 저장 (이 기기, 이 브라우저에서만) ----
  function storeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 저장 불가: 화면은 그대로 동작 */ }
  }

  function loadRhythms() {
    var list = [];
    try {
      var raw = JSON.parse(storeGet(KEY_RHYTHMS) || '[]');
      if (Array.isArray(raw)) {
        raw.forEach(function (r) {
          if (r && typeof r.name === 'string' && parseIntStrict(r.bpm, MIN_BPM, MAX_BPM) !== null) {
            list.push({ id: String(r.id), name: r.name, bpm: parseInt(r.bpm, 10) });
          }
        });
      }
    } catch (e) { /* 잘못된 저장값은 무시 */ }
    return list;
  }
  function saveRhythms() { storeSet(KEY_RHYTHMS, JSON.stringify(rhythms)); }

  // ---- 화면 전환: 메인 / 마이페이지 ----
  function setView(next) {
    view = next;
    app.dataset.view = next;
    mainOnly.forEach(function (el) { el.hidden = next !== 'main'; });
    mypage.hidden = next !== 'mypage';
    resetBtn.hidden = next !== 'main';
    titleEl.textContent = next === 'main' ? '메뜨로늄' : '마이페이지';
    navBtn.setAttribute('aria-label', next === 'main' ? '마이페이지' : '메인 화면으로');
    if (next === 'mypage') renderRhythms();
  }

  function canLoad() { return state.phase === 'idle' || state.phase === 'paused'; }

  function renderRhythms() {
    rhythmList.textContent = '';
    rhythmEmpty.hidden = rhythms.length > 0;
    rhythmHint.textContent = rhythms.length > 0 && !canLoad()
      ? '불러오기는 대기 또는 일시정지 중에만 할 수 있어요.' : '';
    rhythms.forEach(function (r) {
      var li = document.createElement('li');
      var info = document.createElement('div');
      info.className = 'rhythm-info';
      var name = document.createElement('span');
      name.className = 'rhythm-name';
      name.textContent = r.name;
      var bpm = document.createElement('span');
      bpm.className = 'rhythm-bpm';
      bpm.textContent = r.bpm + ' BPM';
      info.appendChild(name);
      info.appendChild(bpm);
      var load = document.createElement('button');
      load.type = 'button';
      load.className = 'load-btn';
      load.textContent = '불러오기';
      load.disabled = !canLoad();
      load.addEventListener('click', function () { loadRhythm(r); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'del-btn';
      del.textContent = '삭제';
      del.setAttribute('aria-label', r.name + ' 삭제');
      del.addEventListener('click', function () {
        rhythms = rhythms.filter(function (x) { return x.id !== r.id; });
        saveRhythms();
        renderRhythms();
      });
      li.appendChild(info);
      li.appendChild(load);
      li.appendChild(del);
      rhythmList.appendChild(li);
    });
  }

  function loadRhythm(r) {
    if (!canLoad()) return;
    bpmInput.value = r.bpm;
    state.bpm = r.bpm;
    storeSet(KEY_BPM, String(r.bpm));
    validateSettings();
    setView('main');
    saveNote.textContent = '"' + r.name + '" 리듬(' + r.bpm + ' BPM)을 불러왔어요.';
    render();
  }

  navBtn.addEventListener('click', function () {
    setView(view === 'main' ? 'mypage' : 'main');
  });

  saveOpenBtn.addEventListener('click', function () {
    saveForm.hidden = false;
    saveNote.textContent = '';
    rhythmName.focus();
  });
  saveCancelBtn.addEventListener('click', function () {
    saveForm.hidden = true;
    rhythmName.value = '';
  });
  saveForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = validateSettings(); // 입력창에 적힌 BPM 그대로 저장한다
    if (!v) {
      saveNote.textContent = '속도를 ' + MIN_BPM + '~' + MAX_BPM + ' 사이의 정수로 고친 뒤 저장해 주세요.';
      return;
    }
    var name = rhythmName.value.trim() || ('리듬 ' + (rhythms.length + 1));
    rhythms.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, bpm: v.bpm });
    saveRhythms();
    rhythmName.value = '';
    saveForm.hidden = true;
    saveNote.textContent = '"' + name + '" (' + v.bpm + ' BPM)을 저장했어요. 마이페이지의 내 리듬에서 불러올 수 있어요.';
  });

  // 처음 열 때: 마지막으로 사용한 BPM과 내 리듬을 복원한다
  var savedBpm = parseIntStrict(storeGet(KEY_BPM), MIN_BPM, MAX_BPM);
  if (savedBpm !== null) {
    bpmInput.value = savedBpm;
    state.bpm = savedBpm;
  }
  rhythms = loadRhythms();

  setView('main');
  render();
})();
