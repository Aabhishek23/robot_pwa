// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service Worker Registered'))
    .catch((err) => console.error('Service Worker Registration Failed:', err));
}

// BLE UUIDs
const DEVICE_NAME = "ESP32C3-Robot";
const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"; // Standard Nordic UART Service UUID
const RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

// BLE State
let bleDevice = null;
let rxCharacteristic = null;
let isConnected = false;

// DOM Elements
const statusPulse = document.getElementById('status-pulse');
const statusText = document.getElementById('status-text');
const connectBtn = document.getElementById('connect-btn');
const logContainer = document.getElementById('terminal-log');
const clearLogBtn = document.getElementById('clear-log-btn');
const installBtn = document.getElementById('install-btn');

// Button mappings
const buttons = {
  forward: document.getElementById('btn-forward'),
  backward: document.getElementById('btn-backward'),
  left: document.getElementById('btn-left'),
  right: document.getElementById('btn-right'),
  stop: document.getElementById('btn-stop')
};

// Log utility
function log(msg, type = 'system') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logContainer.appendChild(line);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// CRC-8 Calculation
function calculateCRC(data) {
  let crc = 0x00;
  for (let byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x80) !== 0) {
        crc = ((crc << 1) ^ 0x07) & 0xFF;
      } else {
        crc = (crc << 1) & 0xFF;
      }
    }
  }
  return crc;
}

// Packet Builder
function createPacket(payload) {
  const length = payload.length;
  const frame = [0xAA, length, ...payload];
  const crc = calculateCRC(frame);
  return new Uint8Array([...frame, crc]);
}

// Hex Helper for printing
function toHex(arrayBuffer) {
  return Array.prototype.map.call(new Uint8Array(arrayBuffer), x => ('00' + x.toString(16)).slice(-2).toUpperCase()).join(' ');
}

// Web Bluetooth Connect/Disconnect
async function handleConnect() {
  if (isConnected) {
    disconnectDevice();
    return;
  }

  try {
    log('Scanning for ESP32C3-Robot...', 'system');
    updateStatus('scanning', 'Scanning...');
    connectBtn.disabled = true;

    // Filters must specify the device name. We also need to add SERVICE_UUID to optionalServices 
    // so we can access it after connection.
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ name: DEVICE_NAME }],
      optionalServices: [SERVICE_UUID]
    });

    log(`Found device: ${bleDevice.name}. Connecting...`, 'system');

    bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

    const server = await bleDevice.gatt.connect();
    log('Connected to GATT Server. Discovering service...', 'system');

    const service = await server.getPrimaryService(SERVICE_UUID);
    log('Service discovered. Finding RX characteristic...', 'system');

    rxCharacteristic = await service.getCharacteristic(RX_CHAR_UUID);
    log('RX characteristic acquired. Ready to control!', 'system');

    isConnected = true;
    updateStatus('connected', 'Connected');
    connectBtn.textContent = 'Disconnect';
    connectBtn.classList.add('disconnecting');
    connectBtn.disabled = false;

  } catch (err) {
    log(`Connection failed: ${err.message}`, 'error');
    updateStatus('disconnected', 'Disconnected');
    connectBtn.textContent = 'Connect to Robot';
    connectBtn.classList.remove('disconnecting');
    connectBtn.disabled = false;
    bleDevice = null;
    rxCharacteristic = null;
  }
}

async function disconnectDevice() {
  if (bleDevice && bleDevice.gatt.connected) {
    // Send Stop command (0x05) before disconnect
    try {
      log('Sending Stop command prior to disconnect...', 'system');
      await sendCommand(0x05);
    } catch(e) {}
    
    log('Disconnecting...', 'system');
    bleDevice.gatt.disconnect();
  }
}

function onDisconnected() {
  isConnected = false;
  updateStatus('disconnected', 'Disconnected');
  connectBtn.textContent = 'Connect to Robot';
  connectBtn.classList.remove('disconnecting');
  connectBtn.disabled = false;
  bleDevice = null;
  rxCharacteristic = null;
  log('Device disconnected.', 'error');
}

function updateStatus(state, text) {
  statusPulse.className = `pulse-dot ${state}`;
  statusText.textContent = `Status: ${text}`;
}

// Send Command
async function sendCommand(commandByte) {
  if (!isConnected || !rxCharacteristic) {
    log('Cannot send command: Not connected to robot.', 'error');
    return;
  }

  try {
    const packet = createPacket([commandByte]);
    log(`TX -> [${toHex(packet.buffer)}]`, 'tx');
    await rxCharacteristic.writeValue(packet);
  } catch (err) {
    log(`Write error: ${err.message}`, 'error');
  }
}

// UI Event Handlers
buttons.forward.addEventListener('click', () => sendCommand(0x01));
buttons.backward.addEventListener('click', () => sendCommand(0x02));
buttons.left.addEventListener('click', () => sendCommand(0x03));
buttons.right.addEventListener('click', () => sendCommand(0x04));
buttons.stop.addEventListener('click', () => sendCommand(0x05));

// Key mappings to trigger visual active state
const keyMap = {
  'w': { btn: buttons.forward, cmd: 0x01 },
  'arrowup': { btn: buttons.forward, cmd: 0x01 },
  's': { btn: buttons.backward, cmd: 0x02 },
  'arrowdown': { btn: buttons.backward, cmd: 0x02 },
  'a': { btn: buttons.left, cmd: 0x03 },
  'arrowleft': { btn: buttons.left, cmd: 0x03 },
  'd': { btn: buttons.right, cmd: 0x04 },
  'arrowright': { btn: buttons.right, cmd: 0x04 },
  ' ': { btn: buttons.stop, cmd: 0x05 },
  'x': { btn: buttons.stop, cmd: 0x05 }
};

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (keyMap[key]) {
    e.preventDefault();
    const action = keyMap[key];
    action.btn.classList.add('active');
    // Only send if it's not a repeating event
    if (!e.repeat) {
      sendCommand(action.cmd);
    }
  }
});

document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (keyMap[key]) {
    keyMap[key].btn.classList.remove('active');
  }
});

// Clear Log
clearLogBtn.addEventListener('click', () => {
  logContainer.innerHTML = '';
  log('Terminal cleared.', 'system');
});

// Connect Button Event
connectBtn.addEventListener('click', handleConnect);

// PWA Install Prompt handling
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
  log('App is ready to be installed as PWA!', 'system');
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    log(`User response to install: ${outcome}`, 'system');
    deferredPrompt = null;
    installBtn.classList.add('hidden');
  }
});
