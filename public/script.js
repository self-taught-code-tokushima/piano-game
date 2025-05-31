// pitchyをESモジュールとしてインポート
import { PitchDetector as Pitchy } from 'https://esm.sh/pitchy@4';

// 2. This code loads the IFrame Player API code asynchronously.
var tag = document.createElement('script');

// モジュールのインポートは従来のまま
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// グローバル変数と定数
let audioContext; // Web Audio APIのAudioContextインスタンス
let analyserNode; // ピッチ検出用のAnalyserNode
let mediaStreamSource; // マイク入力のMediaStreamAudioSourceNode
let pitchDetector; // pitchyライブラリのピッチ検出インスタンス
let pitchBuffer; // ピッチ検出用バッファ

let youtubePlayer; // YouTube IFrame Player APIのプレーヤーインスタンス
let midiData = []; // パースされたMIDIノート情報
let currentScore = 0; // 現在のスコア
let isPlaying = false; // 再生中かどうかのフラグ

let expectedNotes = []; // 現在のタイミングで期待されるノートのリスト
let detectedNotesBuffer = []; // 検出されたピッチとタイムスタンプを保持するバッファ

let pitchDetectionIntervalId; // ピッチ検出のインターバルID
let gameLoopIntervalId; // メインゲームループのインターバルID

// ノート判定の許容時間（ミリ秒）
const NOTE_TIMING_TOLERANCE_MS = 200;
// ピッチ判定の許容誤差（半音）
const PITCH_TOLERANCE_SEMITONES = 0.5;
// ゲームループの更新間隔（ミリ秒）
const GAME_LOOP_INTERVAL_MS = 50;
// 検出ピッチバッファの保持期間（秒）
const DETECTED_PITCH_BUFFER_DURATION_SEC = 2;

// DOM要素の取得
const midiFileInput = document.getElementById('midi-file-input');
const midiFileNameSpan = document.getElementById('midi-file-name');
const youtubeIdInput = document.getElementById('youtube-id-input');
const playPauseButton = document.getElementById('play-pause-button');
const judgmentText = document.getElementById('judgment-text');
const scoreDisplay = document.getElementById('score');
const detectedPitchDisplay = document.getElementById('detected-pitch');
const messageBox = document.getElementById('message-box');
const messageContent = document.getElementById('message-content');
const messageCloseButton = document.getElementById('message-close-button');

/**
 * メッセージボックスを表示する関数
 * @param {string} message - 表示するメッセージ
 */
function showMessageBox(message) {
    messageContent.textContent = message;
    messageBox.classList.remove('hidden');
}

/**
 * メッセージボックスを非表示にする関数
 */
function hideMessageBox() {
    messageBox.classList.add('hidden');
}

// メッセージボックスの閉じるボタンにイベントリスナーを設定
messageCloseButton.addEventListener('click', hideMessageBox);

/**
 * 初期化処理
 * DOMContentLoaded後に実行される
 */
document.addEventListener('DOMContentLoaded', init);

function init() {
    // イベントリスナーの設定
    midiFileInput.addEventListener('change', handleMidiFile);
    playPauseButton.addEventListener('click', togglePlayPause);
    youtubeIdInput.addEventListener('input', checkCanPlay); // YouTube ID入力時に再生ボタンの活性状態をチェック

    // Web Audio APIの初期化
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048; // FFTサイズを設定
    } catch (e) {
        showMessageBox('Web Audio APIがサポートされていないか、初期化に失敗しました。ブラウザを更新するか、別のブラウザを試してください。');
        console.error('Web Audio API initialization failed:', e);
        playPauseButton.disabled = true; // 再生ボタンを無効化
        return;
    }

    // マイク入力のセットアップを試みる
    setupMicrophone();

    // YouTube APIの準備は onYouTubeIframeAPIReady で行われる
    // playPauseButton.disabled は、MIDIとYouTube IDが揃ってから有効にする
    checkCanPlay();
}

/**
 * MIDIファイルが選択されたときのハンドラ
 * @param {Event} event - changeイベントオブジェクト
 */
async function handleMidiFile(event) {
    const file = event.target.files[0];
    if (!file) {
        midiFileNameSpan.textContent = "ファイルが選択されていません";
        midiData = [];
        checkCanPlay();
        return;
    }

    midiFileNameSpan.textContent = file.name;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const midi = new Midi(arrayBuffer);

        midiData = [];
        midi.tracks.forEach(track => {
            track.notes.forEach(note => {
                midiData.push({
                    noteNumber: note.midi,
                    startTime: note.time, // 秒単位
                    endTime: note.time + note.duration, // 秒単位
                    velocity: note.velocity // 0-1の範囲
                });
            });
        });

        // MIDIデータを開始時間でソート
        midiData.sort((a, b) => a.startTime - b.startTime);

        console.log('MIDI Data Loaded:', midiData);
        checkCanPlay();
    } catch (error) {
        showMessageBox('MIDIファイルの読み込みまたはパースに失敗しました。有効なMIDIファイルを選択してください。');
        console.error('Error parsing MIDI file:', error);
        midiData = [];
        checkCanPlay();
    }
}

/**
 * マイク入力のセットアップ
 */
async function setupMicrophone() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamSource = audioContext.createMediaStreamSource(stream);
        mediaStreamSource.connect(analyserNode);
        // analyserNode.connect(audioContext.destination); // デバッグ用: マイク入力をスピーカーに出力

        // pitchyの初期化
        pitchDetector = Pitchy.forFloat32Array(analyserNode.fftSize);
        pitchDetector.minVolumeDecibels = -20;

        pitchBuffer = new Float32Array(pitchDetector.inputLength); // ピッチ検出用バッファを初期化
        
        console.log('Microphone setup successful.');
        // マイクがセットアップされたら、再生ボタンの活性状態を再チェック
        checkCanPlay();
    } catch (err) {
        showMessageBox('マイクへのアクセスが拒否されました。アプリケーションを再読み込みし、マイクの使用を許可してください。');
        console.error('Error accessing microphone:', err);
        // マイクアクセスが拒否された場合、再生ボタンを無効化
        playPauseButton.disabled = true;
    }
}

/**
 * YouTube IFrame Player APIが準備完了したときに呼び出される関数
 * ESM として作成しているため、YouTube IFrame Player API から自動で呼び出される関数は window にぶら下げておく
 * https://d.ballade.jp/2022/04/yt-iframe-api-with-esm.html
 */
window.onYouTubeIframeAPIReady = () => {
    console.log('YouTube IFrame API is ready.');
    youtubePlayer = new YT.Player('youtube-player', {
        height: '390', // CSSでアスペクト比を制御するため、ここでは仮の値
        width: '640',  // CSSでアスペクト比を制御するため、ここでは仮の値
        videoId: youtubeIdInput.value || 'CZ1fRbyKK8w', // デフォルト動画ID（例: Rick Astley - Never Gonna Give You Up）
        playerVars: {
            'playsinline': 1,
            'controls': 1 // ユーザーが動画を操作できるようにする
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

/**
 * YouTubeプレーヤーが準備完了したときのハンドラ
 * @param {Event} event - イベントオブジェクト
 */
function onPlayerReady(event) {
    console.log('YouTube Player Ready');
    checkCanPlay(); // プレーヤー準備完了時に再生ボタンの活性状態をチェック
}

/**
 * YouTubeプレーヤーの状態が変化したときのハンドラ
 * @param {Event} event - イベントオブジェクト
 */
function onPlayerStateChange(event) {
    // プレーヤーの状態が再生中 (1) または一時停止 (2) でない場合、isPlayingフラグをリセット
    if (event.data !== window.YT.PlayerState.PLAYING && event.data !== YT.PlayerState.PAUSED) {
        isPlaying = false;
        playPauseButton.textContent = '▶️ 再生';
        stopGameLoop();
        stopPitchDetection();
    } else if (event.data === window.YT.PlayerState.PLAYING) {
        isPlaying = true;
        playPauseButton.textContent = '⏸️ 一時停止';
        startGameLoop();
        startPitchDetection();
    } else if (event.data === window.YT.PlayerState.PAUSED) {
        isPlaying = false;
        playPauseButton.textContent = '▶️ 再生';
        stopGameLoop();
        stopPitchDetection();
    }
}

/**
 * 指定されたIDのYouTube動画を読み込む
 * @param {string} videoId - YouTube動画ID
 */
function loadYouTubeVideo(videoId) {
    if (youtubePlayer && videoId) {
        console.log(`Loading YouTube video with ID: ${videoId}`);
        youtubePlayer.loadVideoById(videoId);
    }
}

/**
 * 現在のYouTube動画の再生時間を秒で取得
 * @returns {number} 現在の再生時間（秒）
 */
function getCurrentYouTubeTime() {
    return youtubePlayer ? youtubePlayer.getCurrentTime() : 0;
}

/**
 * 再生/一時停止ボタンの切り替え
 */
function togglePlayPause() {
    if (!youtubePlayer || !midiData.length || !pitchDetector) {
        showMessageBox('MIDIファイルとYouTube動画IDを読み込み、マイクアクセスを許可してください。');
        return;
    }

    if (isPlaying) {
        youtubePlayer.pauseVideo();
    } else {
        const videoId = youtubeIdInput.value.trim();
        if (videoId && youtubePlayer.getVideoData().video_id !== videoId) {
            loadYouTubeVideo(videoId); // 新しい動画IDが入力されたら読み込み
        }
        youtubePlayer.playVideo();
    }
    isPlaying = !isPlaying; // onPlayerStateChangeで状態が更新されるため、ここでは直接変更しない
}

/**
 * 再生ボタンの活性状態をチェックする
 */
function checkCanPlay() {
    const hasMidi = midiData.length > 0;
    const hasYouTubeId = youtubeIdInput.value.trim().length > 0;
    const isYoutubePlayerReady = youtubePlayer && typeof youtubePlayer.playVideo === 'function';
    const isMicrophoneReady = !!pitchDetector; // pitchDetectorが初期化されていればマイクは準備完了

    console.log(`Can play: MIDI=${hasMidi}, YouTube ID=${hasYouTubeId}, YouTube Player Ready=${isYoutubePlayerReady}, Microphone Ready=${isMicrophoneReady}`);
    playPauseButton.disabled = !(hasMidi && hasYouTubeId && isYoutubePlayerReady && isMicrophoneReady);
}


/**
 * ピッチ検出を開始する
 */
function startPitchDetection() {
    if (pitchDetectionIntervalId) return; // 既に開始されている場合は何もしない
    pitchDetectionIntervalId = setInterval(detectPitch, 100); // 100msごとにピッチ検出
    console.log('Pitch detection started.');
}

/**
 * ピッチ検出を停止する
 */
function stopPitchDetection() {
    if (pitchDetectionIntervalId) {
        clearInterval(pitchDetectionIntervalId);
        pitchDetectionIntervalId = null;
        console.log('Pitch detection stopped.');
    }
    detectedPitchDisplay.textContent = '-';
}

/**
 * ピッチを検出する
 */
function detectPitch() {
    if (!analyserNode || !pitchDetector || !audioContext) return;

    analyserNode.getFloatTimeDomainData(pitchBuffer); // 時間領域データを取得
    const [pitch, clarity] = pitchDetector.findPitch(pitchBuffer, audioContext.sampleRate); // ピッチと明瞭度を検出

    console.log(`Detected pitch: ${pitch} Hz, Clarity: ${clarity}`);

    // ある程度の明瞭度がある場合のみピッチを処理
    if (clarity > 0.9 && pitch > 0) { // clarityの閾値を調整
        const midiNote = frequencyToMidiNote(pitch);
        detectedPitchDisplay.textContent = `${midiNote.toFixed(2)} (${pitch.toFixed(2)} Hz)`;
        
        // 検出されたノートをバッファに追加
        detectedNotesBuffer.push({
            midiNote: midiNote,
            timestamp: audioContext.currentTime // Web Audio APIのタイムスタンプを使用
        });

        // 古いノートをバッファから削除
        const cutoffTime = audioContext.currentTime - DETECTED_PITCH_BUFFER_DURATION_SEC;
        detectedNotesBuffer = detectedNotesBuffer.filter(note => note.timestamp >= cutoffTime);

    } else {
        detectedPitchDisplay.textContent = '-';
    }
}

/**
 * 周波数をMIDIノート番号に変換するヘルパー関数
 * @param {number} frequency - 周波数（Hz）
 * @returns {number} MIDIノート番号
 */
function frequencyToMidiNote(frequency) {
    return 69 + 12 * Math.log2(frequency / 440);
}

/**
 * メインゲームループを開始する
 */
function startGameLoop() {
    if (gameLoopIntervalId) return; // 既に開始されている場合は何もしない
    gameLoopIntervalId = setInterval(gameLoop, GAME_LOOP_INTERVAL_MS);
    console.log('Game loop started.');
}

/**
 * メインゲームループを停止する
 */
function stopGameLoop() {
    if (gameLoopIntervalId) {
        clearInterval(gameLoopIntervalId);
        gameLoopIntervalId = null;
        console.log('Game loop stopped.');
    }
}

/**
 * メインゲームループ
 * YouTubeの再生時間と同期し、演奏判定を行う
 */
function gameLoop() {
    if (!isPlaying || !midiData.length || !youtubePlayer) return;

    const currentTime = getCurrentYouTubeTime(); // YouTubeの現在の再生時間（秒）
    const audioContextTime = audioContext.currentTime; // Web Audio APIの現在の時間（秒）

    // 期待されるノートを特定
    // 現在の再生時間±許容範囲に開始時間があるノートを探す
    expectedNotes = midiData.filter(note => {
        const startMs = note.startTime * 1000;
        const currentMs = currentTime * 1000;
        return startMs >= (currentMs - NOTE_TIMING_TOLERANCE_MS) &&
               startMs <= (currentMs + NOTE_TIMING_TOLERANCE_MS);
    });

    // 検出されたノートと期待されるノートを比較
    let matchedExpectedNotes = new Set(); // 既にマッチした期待されるノートのインデックスを記録
    let matchedDetectedNotes = new Set(); // 既にマッチした検出されたノートのインデックスを記録

    expectedNotes.forEach((expectedNote, expIdx) => {
        // 既にマッチしている場合はスキップ
        if (matchedExpectedNotes.has(expIdx)) return;

        // 検出されたノートバッファから、期待されるノートに近いものを見つける
        detectedNotesBuffer.forEach((detectedNote, detIdx) => {
            // 既にマッチしている場合はスキップ
            if (matchedDetectedNotes.has(detIdx)) return;

            // ピッチの許容誤差をチェック
            const pitchDiff = Math.abs(expectedNote.noteNumber - detectedNote.midiNote);
            if (pitchDiff <= PITCH_TOLERANCE_SEMITONES) {
                // タイミングの許容誤差をチェック
                // YouTube時間と検出時間の差を考慮
                // 検出ノートのタイムスタンプはAudioContextの時間なので、YouTube時間とのオフセットを考慮する必要がある
                // ここではシンプルに、検出されたノートのタイムスタンプと現在のYouTube時間の差を比較
                const detectedTimeRelativeMs = (detectedNote.timestamp - audioContextTime) * 1000;
                const expectedTimeRelativeMs = (expectedNote.startTime - currentTime) * 1000;
                const timingDiff = Math.abs(detectedTimeRelativeMs - expectedTimeRelativeMs);


                if (timingDiff <= NOTE_TIMING_TOLERANCE_MS) {
                    // 正解！
                    updateFeedback(true, expectedNote, detectedNote);
                    updateScore(10); // 10ポイント加算
                    matchedExpectedNotes.add(expIdx);
                    matchedDetectedNotes.add(detIdx);
                    return; // この期待されるノートはマッチしたので次へ
                }
            }
        });
    });

    // ここで、マッチしなかった期待されるノート（つまりミスしたノート）に対するフィードバックも考えられる
    // 現状では、マッチしたノートのみを判定
    // TODO: ミスしたノートの判定ロジックを追加することも可能（例: expectedNotesに残っているがmatchedExpectedNotesに含まれないもの）
}

/**
 * フィードバック表示を更新する
 * @param {boolean} isCorrect - 正解かどうか
 * @param {object} expectedNote - 期待されたノート情報
 * @param {object} userNote - ユーザーが演奏したノート情報（検出されたピッチ）
 */
function updateFeedback(isCorrect, expectedNote, userNote) {
    if (isCorrect) {
        judgmentText.textContent = '🎉 OK! 🎉';
        judgmentText.className = 'feedback-message correct';
    } else {
        // このパスは現在のロジックではあまり使われないが、将来的にミス判定を追加する際に使用
        judgmentText.textContent = '😅 おしい！ 😅';
        judgmentText.className = 'feedback-message incorrect';
    }
    // 短時間でフィードバック表示をリセット
    setTimeout(() => {
        judgmentText.textContent = 'ここに判定結果';
        judgmentText.className = 'feedback-message';
    }, 500);
}

/**
 * スコアを更新し表示する
 * @param {number} points - 加算するポイント
 */
function updateScore(points) {
    currentScore += points;
    scoreDisplay.textContent = currentScore;
}
