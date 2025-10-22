// =======================================================
// CONFIGURACIÓN GLOBAL Y LIBRERÍAS
// =======================================================
const { Renderer, Stave, Formatter, Voice, StaveNote } = Vex.Flow;
let context, stave;

// Secuencia de notas a practicar (Do4, Re4, Mi4, Fa4, Sol4)
// VexFlow Notación: nota/octava
const NOTE_SEQUENCE_STRINGS = [
    "C/4", "D/4", "E/4", "F/4", "G/4", "F/4", "E/4", "D/4", "C/4"
];

// Almacenamiento de notas y controles
let vexFlowNotes = [];
let synth = null;
let pitchDetector = null; // Objeto de ml5.pitchDetection

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

    const A4 = 440;
    const C0 = 16.35; // Frecuencia de C0
    const semitonesFromC0 = 12 * Math.log2(frequency / C0);
    const noteIndex = Math.round(semitonesFromC0);
    
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const noteName = noteNames[noteIndex % 12];
    const octave = Math.floor(noteIndex / 12);
    
    // Simplificar las notas con sostenidos a sus equivalentes naturales si es posible (C# -> C, D# -> D, etc. para la comparación)
    // El objetivo es solo saber si está en la nota principal
    let cleanNoteName = noteName.replace('#', '');
    
    return cleanNoteName + octave;
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
    // Iniciar el contexto de audio (requerido por Tone.js)
    if (Tone.context.state !== 'running') {
        await Tone.start();
    }
    
    if (!synth) {
        synth = new Tone.Synth().toDestination();
    }
    
    updateFeedback('Reproduciendo secuencia...');

    let time = Tone.now();
    const duration = '0.4'; // Duración de cada nota
    const spacing = 0.1; // Pequeño espacio entre notas

    vexFlowNotes.forEach(note => {
        // Tone.js usa C4, D4, E4...
        const noteName = note.keys[0].replace('/', ''); 
        
        synth.triggerAttackRelease(noteName, duration, time);
        
        // Avanzar el tiempo para la siguiente nota
        time += Tone.Time(duration).toSeconds() + spacing; 
    });

    // Re-habilitar el botón de comparación después de que termine
    setTimeout(() => {
        updateFeedback('Listo para Iniciar Comparación. ¡Canta la secuencia!');
    }, time * 1000); 
}

// =======================================================
// 3. RECONOCIMIENTO DE TONO (ML5.JS)
// =======================================================
async function startMicrophone() {
    try {
        updateFeedback('Cargando modelo de tono...');
        
        // Usar ml5.js para el acceso al micrófono y detección de tono
        // Usamos la API nativa de audio para alimentar ml5
        const audioContext = new AudioContext();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const micStream = audioContext.createMediaStreamSource(stream);

        // Cargar el modelo de detección de tono (basado en Autocorrelación)
        pitchDetector = ml5.pitchDetection('model/crepe', audioContext, micStream, () => {
            updateFeedback('🎤 Micrófono conectado. Modelo cargado. Listo para empezar.');
            startMicBtn.disabled = true;
            playBtn.disabled = false;
            startMatchBtn.disabled = false;
        });

    } catch (error) {
        console.error("Error al acceder al micrófono:", error);
        updateFeedback('❌ Error al acceder al micrófono. Asegúrate de dar permiso y usar HTTPS.', false);
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
    const targetNoteStr = NOTE_SEQUENCE_STRINGS[currentNoteIndex].replace('/', ''); 

    // 2. Obtener la frecuencia detectada
    pitchDetector.getPitch((err, frequency) => {
        if (err) {
            console.error("Error en detección de tono:", err);
            return;
        }

        if (frequency) {
            // 3. Convertir frecuencia a nota y limpiar el nombre (ignorando sostenidos para simplificar)
            const detectedNote = frequencyToNote(frequency);
            const cleanDetected = detectedNote.replace('#', '');
            const cleanTarget = targetNoteStr.replace('#', '');
            
            // 4. Comparar (solo la nota y la octava)
            if (cleanDetected === cleanTarget) {
                // Correcto: pasar a la siguiente nota después de un pequeño retraso
                updateFeedback(`✅ En la nota: ${targetNoteStr}. ¡Bien!`);
                currentNoteIndex++;
                if (currentNoteIndex < NOTE_SEQUENCE_STRINGS.length) {
                    // Muestra la siguiente nota a cantar
                    updateFeedback(`✅ Correcto. Siguiente: ${NOTE_SEQUENCE_STRINGS[currentNoteIndex].replace('/', '')}`, true);
                }
                
            } else {
                // Incorrecto
                updateFeedback(`❌ Objetivo: ${targetNoteStr}. Detectado: ${detectedNote}. Intenta de nuevo.`, false);
            }
        } else {
             // Silencio o ruido
             updateFeedback(`Objetivo: ${targetNoteStr}. 🔇 Esperando tu canto...`);
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

    // Inicializa el contexto de audio al interactuar con el botón
    startMicBtn.addEventListener('click', async () => {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
    });
});