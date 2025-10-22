// =======================================================
// CONFIGURACIÓN GLOBAL Y LIBRERÍAS
// =======================================================
const { Renderer, Stave, Formatter, Voice, StaveNote } = Vex.Flow;
let context, stave;

// Secuencia de notas a practicar (Do4, Re4, Mi4, Fa4, Sol4)
const NOTE_SEQUENCE_STRINGS = [
    "C/4", "D/4", "E/4", "F/4", "G/4", "F/4", "E/4", "D/4", "C/4"
];

// Almacenamiento de notas y controles
let synth = null;
let audioContext = null; // Contexto de Audio nativo
let pitchDetector = null; // Objeto de ml5.pitchDetection
let micStream = null;

// Lógica de juego
let currentNoteIndex = 0;
let intervalId = null;
const CHECK_INTERVAL = 200; // Intervalo de chequeo de tono en milisegundos

// Referencias del DOM
const feedbackEl = document.getElementById('output-feedback');
const startMicBtn = document.getElementById('start-mic-btn');
const playBtn = document.getElementById('play-btn');
const startMatchBtn = document.getElementById('start-match-btn');

// =======================================================
// FUNCIONES DE UTILIDAD
// =======================================================
function updateFeedback(message, isCorrect = null) {
    feedbackEl.textContent = message;
    feedbackEl.className = '';
    
    // Remover clases anteriores
    feedbackEl.classList.remove('feedback-correct', 'feedback-incorrect');
    feedbackEl.classList.add('output-feedback');
    
    // Asignar nueva clase de estado
    if (isCorrect === true) {
        feedbackEl.classList.add('feedback-correct');
    } else if (isCorrect === false) {
        feedbackEl.classList.add('feedback-incorrect');
    }
}

// Función para convertir una frecuencia (Hz) a su nombre de nota (e.g., C4)
function frequencyToNote(frequency) {
    if (frequency < 10) return null; // Frecuencias muy bajas son ruido

    const C0_FREQ = 16.35; // Frecuencia de C0
    const semitonesFromC0 = 12 * Math.log2(frequency / C0_FREQ);
    const noteIndex = Math.round(semitonesFromC0);
    
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const noteName = noteNames[noteIndex % 12];
    const octave = Math.floor(noteIndex / 12);
    
    // Retorna la nota natural y la octava (ej: C4, D4, etc.)
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

    // Crear el pentagrama (Stave)
    stave = new Stave(10, 40, 580);
    stave.addClef('treble').addTimeSignature(`${NOTE_SEQUENCE_STRINGS.length}/4`);
    stave.setContext(context).draw();

    // Convertir las cadenas a objetos StaveNote
    vexFlowNotes = NOTE_SEQUENCE_STRINGS.map(noteString => {
        return new StaveNote({ clef: 'treble', keys: [`${noteString}`], duration: 'q' });
    });
    
    // Crear la 'voz' y formatear las notas para que quepan
    const voice = new Voice({ num_beats: NOTE_SEQUENCE_STRINGS.length, beat_value: 4 }).addTickables(vexFlowNotes);
    new Formatter().joinVoices([voice]).format([voice], 500);
    voice.draw(context, stave);
}

// =======================================================
// 2. REPRODUCCIÓN (TONE.JS)
// =======================================================
async function playSequence() {
    // Asegurarse de que el Contexto de Audio esté iniciado y funcionando antes de reproducir
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
    // 1. Garantizar que el AudioContext nativo esté creado y activo (CRUCIAL EN MÓVILES)
    if (!audioContext) {
        audioContext = new AudioContext();
    }
    if (audioContext.state !== 'running') {
        await audioContext.resume();
    }
    
    updateFeedback('Cargando modelo de tono...');
    startMicBtn.disabled = true;

    try {
        // 2. Obtener el flujo de audio del micrófono
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream = audioContext.createMediaStreamSource(stream);

        // 3. Cargar el modelo de detección de tono (usando el modelo hosteado por ml5)
        const modelPath = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data@master/models/pitch/crepe';
        
        pitchDetector = ml5.pitchDetection(modelPath, audioContext, micStream, () => {
            updateFeedback('🎤 Micrófono conectado. Modelo cargado. Listo para empezar.');
            playBtn.disabled = false;
            startMatchBtn.disabled = false;
        });

    } catch (error) {
        // Si falla, el error es probablemente de permiso/hardware.
        console.error("Error al acceder al micrófono:", error);
        updateFeedback('❌ Error al acceder al micrófono. Verifica los permisos del navegador.', false);
        startMicBtn.disabled = false;
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

    // Iniciar el ciclo de comparación
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(checkPitch, CHECK_INTERVAL);
}

function checkPitch() {
    if (currentNoteIndex >= NOTE_SEQUENCE_STRINGS.length) {
        // Fin de la secuencia
        clearInterval(intervalId);
        updateFeedback('✅ ¡Secuencia completada! ¡Excelente trabajo!', true);
        startMatchBtn.disabled = false;
        playBtn.disabled = false;
        return;
    }

    // 1. Obtener la nota objetivo
    const targetNoteStr = NOTE_SEQUENCE_STRINGS[currentNoteIndex]; // C/4
    const cleanTarget = targetNoteStr.replace('/', ''); // C4
    
    // 2. Obtener la frecuencia detectada
    pitchDetector.getPitch((err, frequency) => {
        if (err) {
            console.error("Error en detección de tono:", err);
            return;
        }

        if (frequency) {
            // 3. Convertir frecuencia a nota
            const detectedNote = frequencyToNote(frequency);
            
            // 4. Comparar
            if (detectedNote === cleanTarget) {
                // Correcto: pasar a la siguiente nota
                
                currentNoteIndex++;
                if (currentNoteIndex < NOTE_SEQUENCE_STRINGS.length) {
                    // Muestra la siguiente nota a cantar
                    const nextNote = NOTE_SEQUENCE_STRINGS[currentNoteIndex].replace('/', '');
                    updateFeedback(`✅ En la nota: ${cleanTarget}. Siguiente: ${nextNote}`, true);
                }
                
            } else {
                // Incorrecto
                updateFeedback(`❌ Objetivo: ${cleanTarget}. Detectado: ${detectedNote || 'Silencio/Ruido'}.`, false);
            }
        } else {
             // Silencio o ruido (no hacer nada para no interrumpir el flujo)
        }
    });
}

// =======================================================
// INICIALIZACIÓN Y LISTENERS
// =======================================================
document.addEventListener('DOMContentLoaded', () => {
    drawStave();
    
    // El listener principal que inicia todo
    startMicBtn.addEventListener('click', startMicrophone);
    
    playBtn.addEventListener('click', playSequence);
    startMatchBtn.addEventListener('click', startMatching);
});
