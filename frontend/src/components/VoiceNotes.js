// VoiceNotes.js - Fixed Real-time Updates with Volume Meter and Removed Filler Words
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
  FileDown,
  Trash2,
  ChevronDown,
  StickyNote,
  Lightbulb,
  Volume2,
  Activity,
} from "lucide-react";
import "./VoiceNotes.css";

// Update API URL to match your Flask backend
const API_BASE_URL = 'http://localhost:8000/api';

const WidgetApp = () => {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [activeTab, setActiveTab] = useState("notes");
  const [browserSupported, setBrowserSupported] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [position, setPosition] = useState({
    x: window.innerWidth / 2 - 180,
    y: window.innerHeight / 2 - 250,
  });
  const [dragging, setDragging] = useState(false);

  // Speech coaching states - REMOVED filler_words
  const [sessionId, setSessionId] = useState(null);
  const sessionIdRef = useRef(null); // Add a ref to persist session ID
  const [liveStats, setLiveStats] = useState({
    fluency: 0,
    volume: 0,
    articulation: 0,
    clarity: 0,
    speaking_rate: 0,
    confidence: 0
    // Removed filler_words
  });
  const [speechAnalysis, setSpeechAnalysis] = useState(null);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);

  const dragOffset = useRef({ x: 0, y: 0 });
  const recognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunks = useRef([]);
  const statsIntervalRef = useRef(null);
  const lastProcessedText = useRef("");

  /** --- Real-time Volume Analysis --- **/
  const analyzeAudioVolume = useCallback((stream) => {
    if (!audioContextRef.current) return;
    
    const analyser = audioContextRef.current.createAnalyser();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    source.connect(analyser);
    
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const updateVolume = () => {
      if (!isRecording) return;
      
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate RMS volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      const volume = Math.min(100, (rms / 128) * 100); // Normalize to 0-100
      
      setLiveStats(prev => ({ ...prev, volume: Math.round(volume) }));
      
      if (isRecording) {
        requestAnimationFrame(updateVolume);
      }
    };
    
    updateVolume();
  }, [isRecording]);

  /** --- Dragging Logic --- **/
  const handleMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('form')) {
      return;
    }
    setDragging(true);
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };
  
  const handleMouseMove = useCallback((e) => {
    if (!dragging) return;
    setPosition({
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y,
    });
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  /** --- Browser Support Check --- **/
  useEffect(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setBrowserSupported(false);
      setError("Speech recognition not supported in this browser. Please use Chrome.");
    }
  }, []);

  /** --- Real-time Stats Polling --- **/
  const startStatsPolling = useCallback((currentSessionId) => {
    console.log('Starting stats polling for session:', currentSessionId);
    
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }

    statsIntervalRef.current = setInterval(async () => {
      if (!currentSessionId) {
        console.log('No session ID, stopping polling');
        return;
      }

      try {
        console.log('Polling stats for session:', currentSessionId);
        const response = await fetch(`${API_BASE_URL}/voice/session/${currentSessionId}/stats`);
        
        if (response.ok) {
          const data = await response.json();
          console.log('Stats response:', data);
          
          if (data.success && data.live_stats) {
            setLiveStats(prev => {
              console.log('Updating live stats:', data.live_stats);
              // Don't override volume from real-time analysis, only update other stats
              const { volume: currentVolume, ...otherStats } = prev;
              return { 
                ...prev, 
                ...data.live_stats,
                volume: currentVolume // Keep real-time volume
              };
            });
          }
        } else {
          console.error('Stats request failed:', response.status);
        }
      } catch (error) {
        console.error('Stats polling error:', error);
      }
    }, 1000); // Poll every second
  }, []);

  const stopStatsPolling = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
  }, []);

  /** --- Create Voice Session --- **/
  const createVoiceSession = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/voice/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success) {
        setSessionId(data.session_id);
        sessionIdRef.current = data.session_id; // Store in ref for persistence
        console.log('Voice session created:', data.session_id);
        return data.session_id;
      } else {
        throw new Error(data.error || 'Failed to create session');
      }
    } catch (error) {
      console.error('Session creation error:', error);
      setError(`Session creation failed: ${error.message}`);
      return null;
    }
  };

  /** --- Initialize Audio Processing --- **/
  const initAudioProcessing = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      
      // Start real-time volume analysis
      analyzeAudioVolume(stream);
      
      const options = { mimeType: 'audio/webm' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options.mimeType = '';
        }
      }
      
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
          processAudioChunk(event.data);
        }
      };
      
      return { stream };
    } catch (error) {
      console.error('Audio initialization error:', error);
      setError(`Audio initialization failed: ${error.message}`);
      return null;
    }
  };

  /** --- Process Audio Chunks with Text --- **/
  const processAudioChunk = async (audioData, textChunk = '') => {
    if (!sessionId || !isRecording) return;
    
    try {
      const arrayBuffer = await audioData.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      uint8Array.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      const base64Audio = btoa(binary);
      
      const response = await fetch(`${API_BASE_URL}/voice/session/${sessionId}/audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_data: base64Audio,
          text_chunk: textChunk
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success && data.live_stats) {
        setLiveStats(prev => {
          // Don't override volume from real-time analysis
          const { volume: currentVolume, ...otherStats } = prev;
          return { 
            ...prev, 
            ...data.live_stats,
            volume: currentVolume // Keep real-time volume
          };
        });
      }
    } catch (error) {
      console.error('Audio processing error:', error);
    }
  };

  /** --- Process Text Updates --- **/
  const processTextUpdate = async (newText) => {
    // Use ref for session ID to avoid timing issues with state
    const currentSessionId = sessionIdRef.current || sessionId;
    
    if (!currentSessionId || !newText.trim()) {
      console.log('Skipping text processing:', { 
        sessionId: currentSessionId, 
        stateSessionId: sessionId,
        hasText: !!newText.trim() 
      });
      return;
    }
    
    // Avoid sending duplicate text
    if (newText === lastProcessedText.current) {
      console.log('Skipping duplicate text:', newText);
      return;
    }
    lastProcessedText.current = newText;
    
    console.log('Processing text update:', newText);
    console.log('Sending to URL:', `${API_BASE_URL}/voice/session/${currentSessionId}/audio`);
    
    try {
      const requestBody = {
        audio_data: '',
        text_chunk: newText.trim()
      };
      console.log('Request body:', requestBody);
      
      const response = await fetch(`${API_BASE_URL}/voice/session/${currentSessionId}/audio`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Text processing response:', data);
        if (data.success && data.live_stats) {
          console.log('Updating stats from text processing:', data.live_stats);
          setLiveStats(prev => {
            // Don't override volume from real-time analysis
            const { volume: currentVolume, ...otherStats } = prev;
            return { 
              ...prev, 
              ...data.live_stats,
              volume: currentVolume // Keep real-time volume
            };
          });
        } else {
          console.log('No stats in response or success=false');
        }
      } else {
        const errorText = await response.text();
        console.error('Text processing failed:', response.status, errorText);
      }
    } catch (error) {
      console.error('Text processing error:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
  };

  /** --- Initialize Speech Recognition --- **/
  const initSpeechRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('Speech recognition started');
    };

    recognition.onresult = (event) => {
      console.log('Speech recognition result event:', event);
      let interim = "";
      let final = "";
      let newFinalText = "";
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        console.log(`Result ${i}: "${transcript}" (final: ${event.results[i].isFinal})`);
        
        if (event.results[i].isFinal) {
          final += transcript + " ";
          newFinalText = transcript;
        } else {
          interim += transcript;
        }
      }
      
      console.log('Final text:', final);
      console.log('Interim text:', interim);
      
      if (final) {
        setFinalTranscript(prev => {
          const updated = prev + final;
          console.log('Updated final transcript:', updated);
          return updated;
        });
        setTranscript(prev => {
          const updated = prev + final + interim;
          console.log('Updated full transcript:', updated);
          return updated;
        });
        
        // Process new final text for analysis
        if (newFinalText.trim()) {
          console.log('Processing new final text:', newFinalText.trim());
          processTextUpdate(newFinalText.trim());
        }
      } else {
        setTranscript(finalTranscript + interim);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === "not-allowed") {
        setError("Microphone access denied. Please allow microphone access and refresh the page.");
      } else if (event.error === "network") {
        setError("Network error during speech recognition.");
      } else if (event.error !== "no-speech") {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      console.log('Speech recognition ended');
      if (isRecording) {
        setTimeout(() => {
          if (isRecording && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (error) {
              console.error('Error restarting speech recognition:', error);
            }
          }
        }, 100);
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [finalTranscript, isRecording]);

  /** --- Start Recording --- **/
  const startRecording = async () => {
    if (isProcessingAudio || isRecording) return;
    
    setIsProcessingAudio(true);
    setError("");
    
    try {
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        currentSessionId = await createVoiceSession();
        if (!currentSessionId) {
          throw new Error('Failed to create voice session');
        }
      }

      const audioSetup = await initAudioProcessing();
      if (!audioSetup) {
        throw new Error('Failed to initialize audio');
      }

      const response = await fetch(`${API_BASE_URL}/voice/session/${currentSessionId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to start recording session');
      }

      const recognition = initSpeechRecognition();
      recognition.start();
      
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.start(1000); // 1 second chunks
      }

      setIsRecording(true);
      
      // Start polling for stats immediately with the session ID
      console.log('Starting polling with session ID:', currentSessionId);
      startStatsPolling(currentSessionId);

      // Reset last processed text
      lastProcessedText.current = "";

      console.log('Recording started successfully');

    } catch (error) {
      console.error('Start recording error:', error);
      setError(`Failed to start recording: ${error.message}`);
      
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      setIsRecording(false);
    } finally {
      setIsProcessingAudio(false);
    }
  };

  /** --- Stop Recording --- **/
  const stopRecording = async () => {
    if (!sessionId || !isRecording) return;
    
    setIsProcessingAudio(true);
    
    try {
      // Stop stats polling first
      stopStatsPolling();
      
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      setIsRecording(false);

      const response = await fetch(`${API_BASE_URL}/voice/session/${sessionId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success) {
        if (data.analysis) {
          setSpeechAnalysis(data.analysis);
          setActiveTab("tips");
          console.log('Analysis received:', data.analysis);
        }
      } else {
        throw new Error(data.error || 'Failed to stop recording session');
      }

      audioChunks.current = [];
      
      console.log('Recording stopped successfully');

    } catch (error) {
      console.error('Stop recording error:', error);
      setError(`Failed to stop recording: ${error.message}`);
    } finally {
      setIsProcessingAudio(false);
    }
  };

  /** --- Toggle Recording --- **/
  const toggleRecording = () => {
    if (isProcessingAudio) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  /** --- Get Progress Bar Color --- **/
  const getProgressBarColor = (value) => {
    if (value >= 80) return 'high';
    if (value >= 60) return 'medium';
    return 'low';
  };

  /** --- Render Progress Bar --- **/
  const renderProgressBar = (label, value, metric) => (
    <div className="progress-item" key={label}>
      <div className="progress-label">
        <span>{label}</span>
        <span>
          {metric === 'speaking_rate' ? Math.round(value) + ' WPM' : Math.round(value) + '%'}
        </span>
      </div>
      <div className="progress-bar">
        <div 
          className={`progress-fill ${getProgressBarColor(value)}`}
          style={{ width: `${Math.min(100, Math.max(0, metric === 'speaking_rate' ? (value / 200) * 100 : value))}%` }}
        ></div>
      </div>
    </div>
  );

  /** --- Transcript Management --- **/
  const clearTranscript = async () => {
    if (isRecording) {
      await stopRecording();
    }
    
    setTranscript("");
    setFinalTranscript("");
    setSpeechAnalysis(null);
    
    if (sessionId) {
      try {
        await fetch(`${API_BASE_URL}/voice/session/${sessionId}`, { method: 'DELETE' });
      } catch (error) {
        console.error('Error deleting session:', error);
      }
      setSessionId(null);
      sessionIdRef.current = null; // Clear the ref too
    }
    
    setLiveStats({
      fluency: 0,
      volume: 0,
      articulation: 0,
      clarity: 0,
      speaking_rate: 0,
      confidence: 0
      // Removed filler_words
    });

    lastProcessedText.current = "";
  };

  const downloadTranscript = () => {
    if (!finalTranscript.trim()) return;
    
    let content = `Speech Transcript - ${new Date().toLocaleString()}\n\n`;
    content += `Transcript:\n${finalTranscript}\n\n`;
    
    if (speechAnalysis) {
      content += `Analysis:\n`;
      content += `Overall Score: ${speechAnalysis.overall_score}/10\n\n`;
      
      if (speechAnalysis.observations) {
        content += `Observations:\n`;
        speechAnalysis.observations.forEach((obs, idx) => {
          content += `${idx + 1}. ${obs}\n`;
        });
        content += '\n';
      }
      
      if (speechAnalysis.improvements) {
        content += `Suggestions:\n`;
        speechAnalysis.improvements.forEach((imp, idx) => {
          content += `${idx + 1}. ${imp}\n`;
        });
        content += '\n';
      }
      
      if (speechAnalysis.quick_tip) {
        content += `Quick Tip: ${speechAnalysis.quick_tip}\n`;
      }
    }
    
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `speech-analysis-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** --- Authentication Logic --- **/
  const handleAuth = (e) => {
    e.preventDefault();
    const emailTrimmed = credentials.email.trim();
    const passwordTrimmed = credentials.password.trim();
    if (!emailTrimmed || !passwordTrimmed) {
      setError("Email and password are required.");
      return;
    }

    const storedUsers = JSON.parse(localStorage.getItem("users") || "{}");
    if (authMode === "signup") {
      if (storedUsers[emailTrimmed]) {
        setError("User exists. Please login.");
        return;
      }
      storedUsers[emailTrimmed] = passwordTrimmed;
      localStorage.setItem("users", JSON.stringify(storedUsers));
      setUser({ email: emailTrimmed });
      setError("");
    } else {
      if (
        !storedUsers[emailTrimmed] ||
        storedUsers[emailTrimmed] !== passwordTrimmed
      ) {
        setError("Invalid email or password.");
        return;
      }
      setUser({ email: emailTrimmed });
      setError("");
    }
    setCredentials({ email: "", password: "" });
  };

  const handleLogout = async () => {
    if (isRecording) {
      await stopRecording();
    }
    
    stopStatsPolling();
    
    if (sessionId) {
      try {
        await fetch(`${API_BASE_URL}/voice/session/${sessionId}`, { method: 'DELETE' });
      } catch (error) {
        console.error('Error cleaning up session:', error);
      }
    }
    
    setUser(null);
    setAuthMode("login");
    setTranscript("");
    setFinalTranscript("");
    setSessionId(null);
    sessionIdRef.current = null; // Clear the ref
    setSpeechAnalysis(null);
    setLiveStats({
      fluency: 0,
      volume: 0,
      articulation: 0,
      clarity: 0,
      speaking_rate: 0,
      confidence: 0
      // Removed filler_words
    });
    lastProcessedText.current = "";
  };

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      stopStatsPolling();
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopStatsPolling]);

  return (
    <div
      className={`ai-widget-wrapper ${isExpanded ? "expanded" : "collapsed"}`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={handleMouseDown}
    >
      {!isExpanded && (
        <button className="expand-btn" onClick={() => setIsExpanded(true)}>
          <Mic size={20} />
        </button>
      )}

      {isExpanded && (
        <div className="ai-meeting-assistant glass-effect">
          <div className="widget-header">
            <h2>{user ? "FairFrame" : "Login / Sign Up"}</h2>
            <button className="collapse-btn" onClick={() => setIsExpanded(false)}>
              <ChevronDown size={18} />
            </button>
          </div>

          {!user ? (
            <div className="auth-box">
              {error && <div className="error-box">{error}</div>}
              <form onSubmit={handleAuth}>
                <input
                  type="email"
                  placeholder="Email"
                  value={credentials.email}
                  onChange={(e) =>
                    setCredentials({ ...credentials, email: e.target.value })
                  }
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={credentials.password}
                  onChange={(e) =>
                    setCredentials({ ...credentials, password: e.target.value })
                  }
                  required
                />
                <button type="submit">
                  {authMode === "login" ? "Login" : "Sign Up"}
                </button>
              </form>
              <p>
                {authMode === "login"
                  ? "Don't have an account?"
                  : "Already have an account?"}{" "}
                <button
                  className="switch-btn"
                  onClick={() => {
                    setAuthMode(authMode === "login" ? "signup" : "login");
                    setError("");
                    setCredentials({ email: "", password: "" });
                  }}
                >
                  {authMode === "login" ? "Sign Up" : "Login"}
                </button>
              </p>
            </div>
          ) : (
            <>
              <div className="top-buttons">
                <button
                  className={`start-btn ${isRecording ? "recording" : ""} ${isProcessingAudio ? "processing" : ""}`}
                  onClick={toggleRecording}
                  disabled={!browserSupported || isProcessingAudio}
                >
                  {isProcessingAudio ? (
                    <Activity size={18} />
                  ) : isRecording ? (
                    <MicOff size={18} />
                  ) : (
                    <Mic size={18} />
                  )}
                  {isProcessingAudio ? "Processing..." : (isRecording ? "Stop" : "Start")}
                </button>
                <button
                  className="export-btn"
                  onClick={downloadTranscript}
                  disabled={!finalTranscript.trim()}
                >
                  <FileDown size={18} /> Export
                </button>
                <button className="logout-btn" onClick={handleLogout}>
                  Logout
                </button>
              </div>

              {error && <div className="error-box">{error}</div>}
              {!browserSupported && (
                <div className="error-box">
                  Speech recognition not supported. Please use Google Chrome.
                </div>
              )}

              <div className="tabs">
                <button
                  className={activeTab === "voice" ? "active" : ""}
                  onClick={() => setActiveTab("voice")}
                >
                  <Volume2 size={16} /> Voice
                </button>
                <button
                  className={activeTab === "tips" ? "active" : ""}
                  onClick={() => setActiveTab("tips")}
                >
                  <Lightbulb size={16} /> Tips
                </button>
                <button
                  className={activeTab === "notes" ? "active" : ""}
                  onClick={() => setActiveTab("notes")}
                >
                  <StickyNote size={16} /> Notes
                </button>
              </div>

              <div className="content-box">
                {activeTab === "voice" && (
                  <div className="voice-content">
                    <div className="voice-status">
                      <div className={`status-indicator ${isRecording ? 'active' : 'inactive'}`}>
                        <div className="status-dot"></div>
                        <span>{isRecording ? 'Live Analysis Active' : 'Ready to Analyze'}</span>
                      </div>
                      {isRecording && (
                        <div className="live-waveform">
                          <div className="wave-bar" style={{ animationDelay: '0ms', height: `${Math.max(20, liveStats.volume)}%` }}></div>
                          <div className="wave-bar" style={{ animationDelay: '100ms', height: `${Math.max(15, liveStats.volume * 0.8)}%` }}></div>
                          <div className="wave-bar" style={{ animationDelay: '200ms', height: `${Math.max(25, liveStats.volume * 1.2)}%` }}></div>
                          <div className="wave-bar" style={{ animationDelay: '300ms', height: `${Math.max(18, liveStats.volume * 0.9)}%` }}></div>
                          <div className="wave-bar" style={{ animationDelay: '400ms', height: `${Math.max(22, liveStats.volume * 1.1)}%` }}></div>
                        </div>
                      )}
                    </div>

                    <div className="metrics-grid">
                      <div className="metric-card primary">
                        <div className="metric-header">
                          <span className="metric-icon">🎯</span>
                          <span className="metric-title">Overall Score</span>
                        </div>
                        <div className="metric-value">
                          {Math.round((liveStats.fluency + liveStats.clarity + liveStats.confidence) / 3)}/100
                        </div>
                        <div className="metric-trend">
                          {isRecording ? 'Analyzing...' : 'Ready'}
                        </div>
                      </div>

                      <div className="metric-card">
                        <div className="metric-header">
                          <span className="metric-icon">⚡</span>
                          <span className="metric-title">Speaking Rate</span>
                        </div>
                        <div className="metric-value">
                          {Math.round(liveStats.speaking_rate || 0)} <span className="unit">WPM</span>
                        </div>
                        <div className="metric-trend">
                          {liveStats.speaking_rate === 0 ? 'Not Started' :
                           liveStats.speaking_rate < 120 ? 'Too Slow' : 
                           liveStats.speaking_rate > 180 ? 'Too Fast' : 'Good Pace'}
                        </div>
                      </div>
                    </div>

                    <div className="progress-section">
                      <h4 className="section-title">Voice Analysis Metrics</h4>
                      
                      {renderProgressBar("Fluency", liveStats.fluency || 0, "fluency")}
                      {renderProgressBar("Volume Level", liveStats.volume || 0, "volume")}
                      {renderProgressBar("Articulation", liveStats.articulation || 0, "articulation")}
                      {renderProgressBar("Clarity", liveStats.clarity || 0, "clarity")}
                      {renderProgressBar("Confidence", liveStats.confidence || 0, "confidence")}
                    </div>

                    <div className="insights-section">
                      <h4 className="section-title">Live Insights</h4>
                      <div className="insight-cards">
                        {liveStats.volume < 20 && isRecording && (
                          <div className="insight-card warning">
                            <span className="insight-icon">🔉</span>
                            <span>Speak louder for better analysis</span>
                          </div>
                        )}
                        {liveStats.speaking_rate > 0 && liveStats.speaking_rate < 100 && (
                          <div className="insight-card info">
                            <span className="insight-icon">🐌</span>
                            <span>Try speaking a bit faster</span>
                          </div>
                        )}
                        {liveStats.speaking_rate > 200 && (
                          <div className="insight-card info">
                            <span className="insight-icon">🏃</span>
                            <span>Consider slowing down slightly</span>
                          </div>
                        )}
                        {liveStats.fluency > 85 && (
                          <div className="insight-card success">
                            <span className="insight-icon">✨</span>
                            <span>Excellent fluency!</span>
                          </div>
                        )}
                        {!isRecording && Object.values(liveStats).every(val => val === 0) && (
                          <div className="insight-card neutral">
                            <span className="insight-icon">🎤</span>
                            <span>Start recording to see live analysis</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="session-stats">
                      <div className="stat-item">
                        <span className="stat-label">Words Spoken</span>
                        <span className="stat-value">{finalTranscript.trim().split(/\s+/).filter(Boolean).length}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Session Time</span>
                        <span className="stat-value">
                          {isRecording ? 'Recording...' : (finalTranscript.trim() ? 'Complete' : 'Not Started')}
                        </span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Analysis Status</span>
                        <span className="stat-value">
                          {sessionId ? 'Active Session' : 'No Session'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                
                {activeTab === "tips" && (
                  <div className="tips-content">
                    {speechAnalysis ? (
                      <div className="analysis-display">
                        <div className="score-section">
                          <div className="overall-score">
                            <span className="score-number">{speechAnalysis.overall_score}/10</span>
                            <span className="score-label">Overall Score</span>
                          </div>
                        </div>
                        
                        {speechAnalysis.observations && speechAnalysis.observations.length > 0 && (
                          <div className="analysis-section">
                            <h4>🎯 What I Observed:</h4>
                            <ul>
                              {speechAnalysis.observations.map((obs, idx) => (
                                <li key={idx}>{obs}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {speechAnalysis.improvements && speechAnalysis.improvements.length > 0 && (
                          <div className="analysis-section">
                            <h4>💡 Suggestions for Improvement:</h4>
                            <ul>
                              {speechAnalysis.improvements.map((imp, idx) => (
                                <li key={idx}>{imp}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {speechAnalysis.strengths && speechAnalysis.strengths.length > 0 && (
                          <div className="analysis-section">
                            <h4>✨ What You Did Well:</h4>
                            <ul>
                              {speechAnalysis.strengths.map((str, idx) => (
                                <li key={idx}>{str}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {speechAnalysis.quick_tip && (
                          <div className="quick-tip">
                            <strong>🗣️ Quick Tip:</strong> {speechAnalysis.quick_tip}
                          </div>
                        )}
                        
                        {speechAnalysis.progress_notes && (
                          <div className="progress-notes">
                            <small><strong>Progress:</strong> {speechAnalysis.progress_notes}</small>
                          </div>
                        )}
                        
                        {speechAnalysis.error && (
                          <div className="analysis-error">
                            <small>Analysis Error: {speechAnalysis.error}</small>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="placeholder">
                        {isRecording ? 
                          "Recording in progress... Stop recording to get your personalized coaching analysis!" :
                          "Record some speech to get personalized coaching tips and analysis!"
                        }
                      </div>
                    )}
                  </div>
                )}
                
                {activeTab === "notes" && (
                  <div className={`notes-box ${!transcript.trim() ? "empty" : ""}`}>
                    {transcript.trim() || 
                      (isRecording ? 
                        "Listening... Start speaking to see your transcript here." : 
                        "Your transcript will appear here as you speak..."
                      )
                    }
                  </div>
                )}
              </div>

              <div className="footer">
                <span>
                  {finalTranscript.trim().split(/\s+/).filter(Boolean).length} words
                  {isRecording && <span className="recording-indicator"> • Recording</span>}
                  {sessionId && <span className="session-indicator"> • Session Active</span>}
                </span>
                <button
                  className="clear-btn"
                  onClick={clearTranscript}
                  disabled={!finalTranscript.trim() && !isRecording}
                >
                  <Trash2 size={16} /> Clear
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default WidgetApp;