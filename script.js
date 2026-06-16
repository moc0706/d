let peer = null;
let conn = null;
let myId = null;
let isHost = false;

// ゲーム状態
let myHand = [];
let opponentCardCount = 0;
let isMyTurn = false;

// トランプの準備（簡易版：数字1〜5×2枚ずつ ＋ ジョーカー1枚 ＝ 計11枚）
// ※テストしやすくするため枚数を減らしています。増やす場合は数値を調整してください。
const CARD_TYPES = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 'Joker'];

// DOM要素
const btnMakeRoom = document.getElementById('btn-make-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const peerIdInput = document.getElementById('peer-id-input');
const myIdDisplay = document.getElementById('my-id');
const connectionStatus = document.getElementById('connection-status');
const connectionPanel = document.getElementById('connection-panel');
const gamePanel = document.getElementById('game-panel');
const btnStart = document.getElementById('btn-start');
const turnDisplay = document.getElementById('turn-display');
const myHandDiv = document.getElementById('my-hand');
const opponentHandDiv = document.getElementById('opponent-hand');
const opponentCountSpan = document.getElementById('opponent-count');
const systemMessage = document.getElementById('system-message');

// --- 1. ネットワーク接続処理 ---

// ホストとして部屋を作成
btnMakeRoom.addEventListener('click', () => {
    isHost = true;
    initPeer();
});

// ゲストとして参加
btnJoinRoom.addEventListener('click', () => {
    isHost = false;
    const targetId = peerIdInput.value.trim();
    if (!targetId) return alert('部屋IDを入力してください');
    
    initPeer(() => {
        conn = peer.connect(targetId);
        setupConnection();
    });
});

function initPeer(callback) {
    peer = new Peer();
    
    peer.on('open', (id) => {
        myId = id;
        myIdDisplay.textContent = id;
        connectionStatus.textContent = isHost ? '相手の接続を待っています...' : '接続中...';
        if(callback) callback();
    });

    // ホスト側がゲストからの接続を受け付ける処理
    peer.on('connection', (connection) => {
        if (isHost) {
            conn = connection;
            setupConnection();
        }
    });
}

function setupConnection() {
    conn.on('open', () => {
        connectionStatus.textContent = '接続完了！ゲームに移動します。';
        connectionPanel.classList.add('hidden');
        gamePanel.classList.remove('hidden');
        
        if (isHost) {
            btnStart.classList.remove('hidden');
            turnDisplay.textContent = 'あなたがホストです。ゲームを開始してください。';
        } else {
            turnDisplay.textContent = 'ホストがゲームを開始するのを待っています...';
        }
    });

    // 相手からデータを受信したときの処理
    conn.on('data', (data) => {
        handleReceiveData(data);
    });
}

// --- 2. ゲームロジック処理 ---

btnStart.addEventListener('click', () => {
    if (!isHost) return;
    btnStart.classList.add('hidden');
    startGame();
});

function startGame() {
    // 山札をシャッフル
    let deck = [...CARD_TYPES].sort(() => Math.random() - 0.5);
    
    // 2人に配る
    let hand1 = [];
    let hand2 = [];
    deck.forEach((card, index) => {
        if (index % 2 === 0) hand1.push(card);
        else hand2.push(card);
    });

    // ホスト自身の手札を処理
    myHand = removePairs(hand1);
    isMyTurn = true; // ホストが先攻

    // 相手（ゲスト）に手札を送信
    let filteredHand2 = removePairs(hand2);
    opponentCardCount = filteredHand2.length;

    sendData({
        type: 'START',
        yourHand: filteredHand2,
        opponentCardCount: myHand.length,
        isYourTurn: false
    });

    updateUI();
}

// ペア（同じ数字）を捨てる関数
function removePairs(hand) {
    let counts = {};
    hand.forEach(card => {
        if(card === 'Joker') {
            counts[card] = 1;
        } else {
            counts[card] = (counts[card] || 0) + 1;
        }
    });

    let newHand = [];
    for (let card in counts) {
        if (card === 'Joker') {
            newHand.push('Joker');
        } else if (counts[card] % 2 !== 0) {
            newHand.push(Number(card));
        }
    }
    return newHand;
}

// データ送信の共通関数
function sendData(obj) {
    if (conn && conn.open) {
        conn.send(obj);
    }
}

// データ受信時の振り分け
function handleReceiveData(data) {
    if (data.type === 'START') {
        myHand = data.yourHand;
        opponentCardCount = data.opponentCardCount;
        isMyTurn = data.isYourTurn;
        systemMessage.textContent = "ゲームが開始されました！";
    } 
    else if (data.type === 'UPDATE_COUNT') {
        opponentCardCount = data.count;
        isMyTurn = data.nextTurn;
    }
    else if (data.type === 'DRAW') {
        // 相手に引かれたカードのインデックス
        const drawnCard = myHand.splice(data.index, 1)[0];
        systemMessage.textContent = `相手にカードを引かれました。`;
        
        // 引かれた後の自分の手札をチェック（揃うことはないが一応）
        myHand = removePairs(myHand);
        
        // ターンを自分交代にする
        isMyTurn = true;
        
        // 相手に自分の最新の枚数を伝える
        sendData({
            type: 'UPDATE_COUNT',
            count: myHand.length,
            nextTurn: false // 相手のターンは終わり
        });

        checkWinLose();
    }
    updateUI();
}

// 相手のカードを引く処理
function drawCard(index) {
    if (!isMyTurn) return;
    
    systemMessage.textContent = `相手のカードを引きに行きます...`;
    
    // 相手に「何番目のカードを引いたか」を伝える
    sendData({
        type: 'DRAW',
        index: index
    });

    // 自分のUIを一時的にロックして、相手からのUPDATE_COUNT（同期）を待つ
    isMyTurn = false; 
    updateUI();
}

// 勝敗判定
function checkWinLose() {
    if (myHand.length === 0 && opponentCardCount === 0) {
        turnDisplay.textContent = "引き分け！";
        isMyTurn = false;
    } else if (myHand.length === 0) {
        turnDisplay.textContent = "あなたの勝ち！🎉";
        isMyTurn = false;
    } else if (opponentCardCount === 0) {
        turnDisplay.textContent = "あなたの負け... 不名誉なババ！";
        isMyTurn = false;
    }
}

// 画面の更新
function updateUI() {
    // 枚数表示
    opponentCountSpan.textContent = opponentCardCount;

    // ターン表示
    if (myHand.length === 0 || opponentCardCount === 0) {
        checkWinLose();
    } else {
        turnDisplay.textContent = isMyTurn ? "あなたのターンです！相手のカードを1枚クリックして引いてください。" : "相手のターンです。待機中...";
    }

    // 自分の手札を描画（数字が見える）
    myHandDiv.innerHTML = '';
    myHand.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        cardEl.textContent = card === 'Joker' ? '🃏' : card;
        myHandDiv.appendChild(cardEl);
    });

    // 相手の手札を描画（裏面・クリック可能）
    opponentHandDiv.innerHTML = '';
    for (let i = 0; i < opponentCardCount; i++) {
        const cardEl = document.createElement('div');
        cardEl.className = 'card back';
        cardEl.textContent = '？';
        
        // 自分のターンならクリックして引けるようにする
        if (isMyTurn) {
            cardEl.addEventListener('click', () => drawCard(i));
        }
        opponentHandDiv.appendChild(cardEl);
    }
}