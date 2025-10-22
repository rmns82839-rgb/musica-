// =======================================================
// CONFIGURACIÓN GLOBAL Y LIBRERÍAS
// =======================================================
const { Renderer, Stave, Formatter, Voice, StaveNote } = Vex.Flow;
let context, stave;

// Secuencia de notas a practicar (Do4, Re4, Mi4, Fa4, Sol4, etc.)
const NOTE_SEQUENCE_STRINGS = [
    "C/4", "D/4", "E/4", "F/4", "G/4", "F/4", "E/4", "D/4", "C/4"
];

// Almacenamiento de notas y controles
let synth = null;
let audioContext = null; 
let pitchDetector = null; 
let micStream = null;

// Lógica de juego
let currentNoteIndex = 0;
let intervalId = null;
const CHECK_INTERVAL = 200; 

// Referencias del DOM
const feedbackEl = document.getElementById('output-feedback');
const startMicBtn = document.getElementById('start-mic-btn');
const playBtn = document.getElementById('play-btn');
const startMatchBtn = document.getElementById('start-match-btn');

// URL del modelo de detección de tono (aseguramos que cargue desde un CDN)
const MODEL_PATH = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data@master/models/pitch/crepe';

// =======================================================
// FUNCIONES DE UTILIDAD
// =======================================================
function updateFeedback(message, isCorrect = null) {
    feedbackEl.textContent = message;
    feedbackEl.className = '';
    
    feedbackEl.classList.remove('feedback-correct', 'feedback-incorrect');
    feedbackEl.classList.add('output-feedback');
    
    if (isCorrect === true) {
        feedbackEl.classList.add('feedback-correct');
    } else if (isCorrect === false) {
        feedbackEl.classList.add('feedback-incorrect');
    }
}

function frequencyToNote(frequency) {
    if (frequency < 10) return null;

    const C0_FREQ = 16.35;
    const semitonesFromC0 = 12 * Math.log2(frequency / C0_FREQ);
    const noteIndex = Math.round(semitonesFromC0);
    
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const noteName = noteNames[noteIndex % 12];
    const octave = Math.floor(noteIndex / 12);
    
    return noteName.replace('#', '') + octave;
}

// =======================================================
// 1. DIBUJAR PENTAGRAMA (VEXFLOW)
// =======================================================
function drawStave() {
    const renderer = new Renderer(document.getElementById('pentagram-area'), Renderer.Backends.SVG);
    renderer.resize(600, 200);
    context = renderer.getContext();
    context.setFont('Arial', 10);

    stave = new Stave(10, 40, 580);
    stave.addClef('treble').addTimeSignature(`${NOTE_SEQUENCE_STRINGS.length}/4`);
    stave.setContext(context).draw();

    vexFlowNotes = NOTE_SEQUENCE_STRINGS.map(noteString => {
        return new StaveNote({ clef: 'treble', keys: [`${noteString}`], duration: 'q' });
    });
    
    const voice = new Voice({ num_beats: NOTE_SEQUENCE_STRINGS.length, beat_value: 4 }).addTickables(vexFlowNotes);
    new Formatter().joinVoices([voice]).format([voice], 500);
    voice.draw(context, stave);
}

// =======================================================
// 2. REPRODUCCIÓN (TONE.JS)
// =======================================================
async function playSequence() {
    // Reanudación de Tone.js (AudioContext separado para reproducción)
    if (Tone.context.state !== 'running') {
        await Tone.start();
    }
    
    if (!synth) {
        synth = new Tone.Synth().toDestination();
    }
    
    updateFeedback('Reproduciendo secuencia...');

    let time = Tone.now();
    const duration = '0.4'; 
    const spacing = 0.1; 

    vexFlowNotes.forEach(note => {
        const noteName = note.keys[0].replace('/', ''); 
        synth.triggerAttackRelease(noteName, duration, time);
        time += Tone.Time(duration).toSeconds() + spacing; 
    });

    setTimeout(() => {
        updateFeedback('Listo para Iniciar Comparación. ¡Canta la secuencia!');
    }, time * 1000); 
}

// =======================================================
// 3. RECONOCIMIENTO DE TONO (ML5.JS)
// =======================================================
async function startMicrophone() {
    startMicBtn.disabled = true;
    updateFeedback('Cargando modelo de tono y solicitando micrófono...');

    try {
        // Inicializar el AudioContext si aún no existe
        if (!audioContext) {
            audioContext = new AudioContext();
        }

        // ***** FIX CRUCIAL PARA MÓVILES *****
        // Forzar la reanudación del Contexto de Audio con la interacción del botón
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // 1. Obtener el flujo de audio del micrófono (aquí el navegador pide permiso)
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream = audioContext.createMediaStreamSource(stream);

        // 2. Cargar el modelo de detección de tono
        pitchDetector = ml5.pitchDetection(MODEL_PATH, audioContext, micStream, () => {
            updateFeedback('🎤 Micrófono conectado. Modelo cargado. Listo para empezar.');
            playBtn.disabled = false;
            startMatchBtn.disabled = false;
        });

    } catch (error) {
        console.error("Error al acceder al micrófono:", error);
        // Habilitar el botón para reintentar
        startMicBtn.disabled = false; 
        updateFeedback('❌ Error al acceder al micrófono. Verifica permisos, especialmente en iOS/Android.', false);
    }
}

// =======================================================
// 4. LÓGICA DE COMPARACIÓN Y FEEDBACK
// =======================================================
function startMatching() {
    if (!pitchDetector) {
        updateFeedback('Conecta el micrófono primero.', false);
        return;
    }
    
    startMatchBtn.disabled = true;
    playBtn.disabled = true;
    currentNoteIndex = 0;
    updateFeedback(`¡Comienza a cantar! Canta la primera nota: ${NOTE_SEQUENCE_STRINGS[0].replace('/', '')}`);

    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(checkPitch, CHECK_INTERVAL);
}

function checkPitch() {
    if (currentNoteIndex >= NOTE_SEQUENCE_STRINGS.length) {
        clearInterval(intervalId);
        updateFeedback('✅ ¡Secuencia completada! ¡Excelente trabajo!', true);
        startMatchBtn.disabled = false;
        playBtn.disabled = false;
        return;
    }

    const targetNoteStr = NOTE_SEQUENCE_STRINGS[currentNoteIndex];
    const cleanTarget = targetNoteStr.replace('/', '');
    
    pitchDetector.getPitch((err, frequency) => {
        if (err) return;

        if (frequency) {
            const detectedNote = frequencyToNote(frequency);
            
            if (detectedNote === cleanTarget) {
                currentNoteIndex++;
                if (currentNoteIndex < NOTE_SEQUENCE_STRINGS.length) {
                    const nextNote = NOTE_SEQUENCE_STRINGS[currentNoteIndex].replace('/', '');
                    updateFeedback(`✅ En la nota: ${cleanTarget}. Siguiente: ${nextNote}`, true);
                }
                
            } else {
                updateFeedback(`❌ Objetivo: ${cleanTarget}. Detectado: ${detectedNote || 'Silencio/Ruido'}.`, false);
            }
        } else {
             // Silencio o ruido (no muestra error, solo espera)
        }
    });
}

// =======================================================
// INICIALIZACIÓN Y LISTENERS
// =======================================================
document.addEventListener('DOMContentLoaded', () => {
    drawStave();
    startMicBtn.addEventListener('click', startMicrophone);
    playBtn.addEventListener('click', playSequence);
    startMatchBtn.addEventListener('click', startMatching);
});
