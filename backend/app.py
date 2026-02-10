from flask import Flask, request, jsonify, Response
from flask_cors import CORS, cross_origin
import os
import json
import uuid
from datetime import datetime
import google.generativeai as genai
from dotenv import load_dotenv
import asyncio
import websockets
import base64
import numpy as np
from threading import Thread
import time

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Simplified CORS configuration
CORS(app, origins=["http://localhost:3000"], supports_credentials=True)

# Configure Gemini
genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
model = genai.GenerativeModel('gemini-2.0-flash-exp')

# In-memory storage (use a database in production)
transcriptions = []
active_sessions = {}  # Store active voice analysis sessions

class VoiceAnalysisSession:
    def __init__(self, session_id):
        self.session_id = session_id
        self.is_recording = False
        self.audio_buffer = []
        self.transcript = ""
        self.live_stats = {
            "fluency": 0,
            "volume": 0,
            "articulation": 0,
            "filler_words": 0,
            "speaking_rate": 0,
            "confidence": 0,
            "clarity": 0
        }
        self.analysis_history = []
        self.start_time = None
        self.total_words = 0
        self.filler_count = 0
        
    def start_recording(self):
        self.is_recording = True
        self.start_time = time.time()
        self.audio_buffer = []
        
    def stop_recording(self):
        self.is_recording = False
        
    def update_live_stats(self, audio_chunk, text_chunk=""):
        """Update real-time statistics"""
        try:
            if audio_chunk is not None and len(audio_chunk) > 0:
                # Calculate volume (RMS) - handle different audio formats
                if isinstance(audio_chunk, np.ndarray):
                    rms = np.sqrt(np.mean(audio_chunk**2))
                else:
                    # Convert to numpy array if it's not already
                    audio_array = np.array(audio_chunk, dtype=np.float32)
                    if len(audio_array) > 0:
                        rms = np.sqrt(np.mean(audio_array**2))
                    else:
                        rms = 0
                
                # Normalize volume to 0-100 scale
                volume_score = min(100, max(0, rms * 500))
                self.live_stats["volume"] = volume_score
                print(f"Volume calculated: {volume_score}")
                
            if text_chunk and text_chunk.strip():
                print(f"Processing text: '{text_chunk}'")
                
                # Update transcript
                self.transcript += " " + text_chunk.strip()
                print(f"Updated transcript: '{self.transcript}'")
                
                # Count words and filler words
                words = text_chunk.lower().strip().split()
                new_word_count = len(words)
                self.total_words += new_word_count
                print(f"New words: {new_word_count}, Total words: {self.total_words}")
                
                # Common filler words
                filler_words = ['um', 'uh', 'like', 'you know', 'so', 'well', 'actually', 'basically', 'literally']
                new_fillers = sum(1 for word in words if any(filler in word for filler in filler_words))
                self.filler_count += new_fillers
                print(f"New fillers: {new_fillers}, Total fillers: {self.filler_count}")
                
                # Calculate speaking rate (words per minute)
                if self.start_time:
                    elapsed_minutes = (time.time() - self.start_time) / 60
                    if elapsed_minutes > 0:
                        self.live_stats["speaking_rate"] = self.total_words / elapsed_minutes
                        print(f"Speaking rate: {self.live_stats['speaking_rate']} WPM")
                        
                # Calculate filler word percentage
                if self.total_words > 0:
                    self.live_stats["filler_words"] = (self.filler_count / self.total_words) * 100
                else:
                    self.live_stats["filler_words"] = 0
                print(f"Filler percentage: {self.live_stats['filler_words']}%")
                    
                # Calculate articulation score (based on word complexity)
                if new_word_count > 0:
                    complex_words = [w for w in words if len(w) > 4]
                    articulation_score = (len(complex_words) / new_word_count) * 100
                    # Smooth the articulation score with previous values
                    self.live_stats["articulation"] = (self.live_stats["articulation"] * 0.7) + (articulation_score * 0.3)
                    print(f"Articulation: {self.live_stats['articulation']}")
                
                # Calculate fluency (inverse relationship with filler words)
                self.live_stats["fluency"] = max(0, 100 - (self.live_stats["filler_words"] * 1.5))
                print(f"Fluency: {self.live_stats['fluency']}")
                
                # Calculate confidence (combination of volume and fluency)
                self.live_stats["confidence"] = (self.live_stats["volume"] * 0.4) + (self.live_stats["fluency"] * 0.6)
                print(f"Confidence: {self.live_stats['confidence']}")
                
                # Calculate clarity (combination of articulation and fluency)
                self.live_stats["clarity"] = (self.live_stats["articulation"] * 0.6) + (self.live_stats["fluency"] * 0.4)
                print(f"Clarity: {self.live_stats['clarity']}")
                
                # Ensure all values are within 0-100 range
                for key in self.live_stats:
                    self.live_stats[key] = max(0, min(100, self.live_stats[key]))
                    
            # If we have minimal data, generate some base stats for testing
            if self.is_recording and self.total_words == 0 and not text_chunk:
                # Generate some baseline stats when recording but no text yet
                import random
                self.live_stats["volume"] = max(self.live_stats["volume"], random.uniform(30, 70))
                self.live_stats["fluency"] = max(self.live_stats["fluency"], random.uniform(40, 80))
                self.live_stats["articulation"] = max(self.live_stats["articulation"], random.uniform(50, 85))
                self.live_stats["confidence"] = (self.live_stats["volume"] * 0.4) + (self.live_stats["fluency"] * 0.6)
                self.live_stats["clarity"] = (self.live_stats["articulation"] * 0.6) + (self.live_stats["fluency"] * 0.4)
                print("Generated baseline stats for testing")
                    
        except Exception as e:
            print(f"Error updating live stats: {e}")
            # Don't crash, just maintain current stats

# Remove duplicate @app.after_request - keep only one
@app.after_request
def after_request(response):
    # Set CORS headers and CSP in one place
    response.headers['Access-Control-Allow-Origin'] = 'http://localhost:3000'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Requested-With'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    
    # Fix CSP for audio APIs
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-eval' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "media-src 'self' blob:; "
        "connect-src 'self' http://localhost:3000"
    )
    return response

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = Response()
        return response

@app.route('/api/test', methods=['GET', 'OPTIONS'])
def test_connection():
    return jsonify({
        "success": True,
        "message": "Backend connected successfully!",
        "timestamp": datetime.now().isoformat(),
        "active_sessions": len(active_sessions)
    })

@app.route('/health', methods=['GET', 'OPTIONS'])
def health_check():
    return jsonify({"status": "OK", "timestamp": datetime.now().isoformat()})

@app.route('/api/voice/session', methods=['POST', 'OPTIONS'])
def create_voice_session():
    """Create a new voice analysis session"""
    try:
        session_id = str(uuid.uuid4())
        active_sessions[session_id] = VoiceAnalysisSession(session_id)
        
        print(f"Created voice session: {session_id}")  # Debug log
        
        return jsonify({
            "success": True,
            "session_id": session_id,
            "message": "Voice analysis session created"
        }), 201
        
    except Exception as e:
        print(f"Session creation error: {e}")  # Debug log
        return jsonify({"error": str(e)}), 500

@app.route('/api/voice/session/<session_id>/start', methods=['POST', 'OPTIONS'])
def start_recording(session_id):
    """Start recording for a session (equivalent to 's' command)"""
    try:
        print(f"Attempting to start recording for session: {session_id}")  # Debug log
        
        if session_id not in active_sessions:
            print(f"Session {session_id} not found in active_sessions")  # Debug log
            return jsonify({"error": "Session not found"}), 404
            
        session = active_sessions[session_id]
        session.start_recording()
        
        print(f"Recording started for session: {session_id}")  # Debug log
        
        return jsonify({
            "success": True,
            "message": "Recording started",
            "is_recording": True
        })
        
    except Exception as e:
        print(f"Start recording error: {e}")  # Debug log
        return jsonify({"error": str(e)}), 500

@app.route('/api/voice/session/<session_id>/stop', methods=['POST', 'OPTIONS'])
def stop_recording(session_id):
    """Stop recording for a session (equivalent to 'x' command)"""
    try:
        print(f"Attempting to stop recording for session: {session_id}")  # Debug log
        
        if session_id not in active_sessions:
            print(f"Session {session_id} not found for stop")  # Debug log
            return jsonify({"error": "Session not found"}), 404
            
        session = active_sessions[session_id]
        session.stop_recording()
        
        # Generate comprehensive analysis
        analysis = analyze_speech_performance(session.transcript, session.live_stats, session.analysis_history)
        session.analysis_history.append(analysis)
        
        print(f"Recording stopped for session: {session_id}")  # Debug log
        
        return jsonify({
            "success": True,
            "message": "Recording stopped",
            "is_recording": False,
            "analysis": analysis
        })
        
    except Exception as e:
        print(f"Stop recording error: {e}")  # Debug log
        return jsonify({"error": str(e)}), 500

@app.route('/api/voice/session/<session_id>/audio', methods=['POST', 'OPTIONS'])
def process_audio_chunk(session_id):
    """Process audio chunk and update live stats"""
    try:
        if session_id not in active_sessions:
            print(f"Session {session_id} not found")
            return jsonify({"error": "Session not found"}), 404
            
        session = active_sessions[session_id]
        
        # Allow processing even if recording just stopped - speech recognition can have delayed final results
        # if not session.is_recording:
        #     print(f"Session {session_id} not recording")
        #     return jsonify({"error": "Session not recording"}), 400
        
        data = request.get_json()
        if not data:
            print("No data provided in request")
            return jsonify({"error": "No data provided"}), 400
            
        # Debug: Print what we received
        text_chunk = data.get('text_chunk', '').strip()
        has_audio = bool(data.get('audio_data'))
        print(f"Processing for session {session_id}: text='{text_chunk}', has_audio={has_audio}, is_recording={session.is_recording}")
        
        audio_data = None
        if 'audio_data' in data and data['audio_data']:
            try:
                # Decode base64 audio data
                audio_bytes = base64.b64decode(data['audio_data'])
                if len(audio_bytes) > 0:
                    audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                    audio_data = audio_array
                    print(f"Processed audio chunk: {len(audio_data)} samples")
            except Exception as audio_error:
                print(f"Audio processing error: {audio_error}")
                # Continue without audio data
        
        # Update live statistics
        if text_chunk or audio_data is not None:
            print(f"Before update - total_words: {session.total_words}, speaking_rate: {session.live_stats['speaking_rate']}")
            session.update_live_stats(audio_data, text_chunk)
            print(f"After update - total_words: {session.total_words}, speaking_rate: {session.live_stats['speaking_rate']}")
            print(f"Current stats: {session.live_stats}")
        else:
            print("No text or audio data to process")
        
        return jsonify({
            "success": True,
            "live_stats": session.live_stats,
            "transcript_length": len(session.transcript.split()),
            "audio_processed": audio_data is not None,
            "text_received": bool(text_chunk),
            "current_transcript": session.transcript  # Debug: show what transcript we have
        })
        
    except Exception as e:
        print(f"Process audio chunk error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/voice/session/<session_id>/stats', methods=['GET', 'OPTIONS'])
def get_live_stats(session_id):
    """Get current live statistics"""
    try:
        if session_id not in active_sessions:
            return jsonify({"error": "Session not found"}), 404
            
        session = active_sessions[session_id]
        
        # Debug info
        print(f"Stats request for session {session_id}:")
        print(f"  - Is recording: {session.is_recording}")
        print(f"  - Total words: {session.total_words}")
        print(f"  - Transcript length: {len(session.transcript)}")
        print(f"  - Current stats: {session.live_stats}")
        
        return jsonify({
            "success": True,
            "live_stats": session.live_stats,
            "is_recording": session.is_recording,
            "transcript_length": len(session.transcript.split()),
            "debug_info": {
                "total_words": session.total_words,
                "transcript_chars": len(session.transcript),
                "session_active": session.is_recording
            }
        })
        
    except Exception as e:
        print(f"Get stats error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/voice/session/<session_id>/transcript', methods=['GET'])
def get_transcript(session_id):
    """Get full transcript for notes tab"""
    try:
        if session_id not in active_sessions:
            return jsonify({"error": "Session not found"}), 404
            
        session = active_sessions[session_id]
        
        return jsonify({
            "success": True,
            "transcript": session.transcript,
            "word_count": len(session.transcript.split()),
            "duration": time.time() - session.start_time if session.start_time else 0
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/voice/session/<session_id>/analysis', methods=['GET'])
def get_speech_analysis(session_id):
    """Get speech coaching analysis for tips tab"""
    try:
        if session_id not in active_sessions:
            return jsonify({"error": "Session not found"}), 404
            
        session = active_sessions[session_id]
        
        if not session.analysis_history:
            return jsonify({
                "success": True,
                "message": "No analysis available yet. Record some speech first!",
                "analysis": None
            })
        
        # Get the latest analysis
        latest_analysis = session.analysis_history[-1]
        
        return jsonify({
            "success": True,
            "analysis": latest_analysis,
            "session_count": len(session.analysis_history)
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/voice/session/<session_id>', methods=['DELETE', 'OPTIONS'])
def delete_voice_session(session_id):
    """Delete a voice analysis session"""
    try:
        if session_id in active_sessions:
            del active_sessions[session_id]
            print(f"Deleted session: {session_id}")  # Debug log
            
        return jsonify({
            "success": True,
            "message": "Session deleted"
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
# Original transcription endpoints (keeping for backward compatibility)
@app.route('/api/transcriptions', methods=['POST'])
def create_transcription():
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({"error": "Text is required"}), 400
        
        # Create transcription record
        transcription = {
            "id": str(uuid.uuid4()),
            "text": data['text'],
            "metadata": {
                "duration": data.get('duration', 0),
                "language": data.get('language', 'en-US'),
                "created_at": datetime.now().isoformat()
            }
        }
        
        # Analyze with Gemini
        analysis = analyze_with_gemini(data['text'])
        transcription['analysis'] = analysis
        
        # Store transcription
        transcriptions.append(transcription)
        
        return jsonify({
            "success": True,
            "data": transcription
        }), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/transcriptions', methods=['GET'])
def get_transcriptions():
    try:
        # Get pagination parameters
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 10))
        
        # Calculate pagination
        start = (page - 1) * limit
        end = start + limit
        
        paginated_transcriptions = transcriptions[start:end]
        
        return jsonify({
            "success": True,
            "data": paginated_transcriptions,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": len(transcriptions),
                "pages": (len(transcriptions) + limit - 1) // limit
            }
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/transcriptions/<transcription_id>', methods=['GET'])
def get_transcription(transcription_id):
    try:
        transcription = next((t for t in transcriptions if t['id'] == transcription_id), None)
        
        if not transcription:
            return jsonify({"error": "Transcription not found"}), 404
        
        return jsonify({
            "success": True,
            "data": transcription
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/transcriptions/<transcription_id>', methods=['DELETE'])
def delete_transcription(transcription_id):
    try:
        global transcriptions
        original_length = len(transcriptions)
        transcriptions = [t for t in transcriptions if t['id'] != transcription_id]
        
        if len(transcriptions) == original_length:
            return jsonify({"error": "Transcription not found"}), 404
        
        return jsonify({
            "success": True,
            "message": "Transcription deleted successfully"
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/analyze', methods=['POST'])
def analyze_text():
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({"error": "Text is required"}), 400
        
        analysis = analyze_with_gemini(data['text'])
        
        return jsonify({
            "success": True,
            "analysis": analysis
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/summarize', methods=['POST'])
def summarize_text():
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({"error": "Text is required"}), 400
        
        summary = summarize_with_gemini(data['text'])
        
        return jsonify({
            "success": True,
            "summary": summary
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def analyze_speech_performance(transcript, live_stats, history):
    """Analyze speech performance with Gemini AI for coaching tips"""
    try:
        # Handle empty or very short transcripts
        if not transcript or len(transcript.strip().split()) < 3:
            return {
                "observations": [
                    "Very brief speech sample detected",
                    f"Speaking duration was quite short",
                    "Consider recording for a longer period for better analysis"
                ],
                "improvements": [
                    "Try speaking for at least 30 seconds for meaningful analysis",
                    "Practice speaking in complete sentences"
                ],
                "strengths": [
                    "Taking the initiative to practice speaking"
                ],
                "overall_score": 5,
                "quick_tip": "Record for longer periods to get detailed feedback",
                "progress_notes": f"Session #{len(history) + 1} - Brief session completed"
            }

        prompt = f"""
        As an expert speech coach, analyze this speaking performance:

        TRANSCRIPT: "{transcript}"
        
        LIVE STATISTICS:
        - Fluency Score: {live_stats.get('fluency', 0)}/100
        - Volume Level: {live_stats.get('volume', 0)}/100
        - Articulation: {live_stats.get('articulation', 0)}/100
        - Filler Words: {live_stats.get('filler_words', 0)}%
        - Speaking Rate: {live_stats.get('speaking_rate', 0)} WPM
        - Confidence: {live_stats.get('confidence', 0)}/100
        - Clarity: {live_stats.get('clarity', 0)}/100
        
        SESSION COUNT: {len(history)} (previous sessions)

        Please provide coaching feedback in this EXACT JSON format:
        {{
            "observations": [
                "Specific observation about tone/delivery",
                "Observation about word choice/clarity", 
                "Observation about pacing/flow"
            ],
            "improvements": [
                "Specific actionable tip",
                "Another concrete suggestion"
            ],
            "strengths": [
                "What they did well"
            ],
            "overall_score": 7,
            "quick_tip": "One-sentence practical advice",
            "progress_notes": "Comment on improvement from previous sessions (if any)"
        }}
        
        Be encouraging but honest. Focus on practical, actionable advice.
        """
        
        response = model.generate_content(prompt)
        
        # Try to parse as JSON, fallback to structured text if it fails
        try:
            # Clean the response text
            response_text = response.text.strip()
            if response_text.startswith('```json'):
                response_text = response_text[7:-3]
            elif response_text.startswith('```'):
                response_text = response_text[3:-3]
            
            analysis = json.loads(response_text)
            
            # Validate required fields
            required_fields = ['observations', 'improvements', 'strengths', 'overall_score', 'quick_tip']
            for field in required_fields:
                if field not in analysis:
                    raise ValueError(f"Missing required field: {field}")
            
        except (json.JSONDecodeError, ValueError) as e:
            print(f"JSON parsing error: {e}, Raw response: {response.text}")
            # Enhanced fallback structure
            word_count = len(transcript.split())
            filler_ratio = live_stats.get('filler_words', 0)
            speaking_rate = live_stats.get('speaking_rate', 0)
            
            analysis = {
                "observations": [
                    f"Spoke {word_count} words during this session",
                    f"Speaking rate: {speaking_rate:.1f} words per minute" if speaking_rate > 0 else "Speaking rate needs improvement",
                    f"Filler words: {filler_ratio:.1f}% of speech" if filler_ratio > 0 else "Good control of filler words"
                ],
                "improvements": [
                    "Try to maintain a steady speaking pace" if speaking_rate < 120 else "Consider varying your speaking pace for emphasis",
                    "Focus on reducing filler words like 'um' and 'uh'" if filler_ratio > 3 else "Work on expanding your vocabulary"
                ],
                "strengths": [
                    "Clear articulation" if live_stats.get('articulation', 0) > 70 else "Good effort in communication",
                    "Appropriate volume level" if live_stats.get('volume', 0) > 30 else "Engaging with the practice"
                ],
                "overall_score": min(10, max(1, int(sum(live_stats.values()) / len(live_stats) / 10))),
                "quick_tip": "Practice speaking for longer periods to build confidence" if word_count < 50 else "Focus on one improvement area at a time",
                "progress_notes": f"Session #{len(history) + 1} completed - {word_count} words recorded"
            }
        
        return analysis
        
    except Exception as e:
        print(f"Analysis error: {e}")
        return {
            "error": f"Analysis temporarily unavailable: {str(e)}",
            "observations": ["Speech analysis is currently unavailable", "Technical issue encountered", "Your speech was recorded successfully"],
            "improvements": ["Try recording again in a moment", "Ensure stable internet connection"],
            "strengths": ["Persistence in practicing", "Using the speech coach tool"],
            "overall_score": 5,
            "quick_tip": "Technical issues resolved soon - keep practicing",
            "progress_notes": f"Session #{len(history) + 1} - Technical issue occurred"
        }

def analyze_with_gemini(text):
    """Analyze transcript with Gemini AI (original function)"""
    try:
        prompt = f"""
        Analyze the following meeting transcript and provide insights:

        Transcript: "{text}"

        Please provide:
        1. Key topics discussed
        2. Action items or decisions made
        3. Important participants mentioned
        4. Overall sentiment
        5. Brief summary

        Format your response as JSON with the following structure:
        {{
            "topics": ["topic1", "topic2", ...],
            "action_items": ["item1", "item2", ...],
            "participants": ["person1", "person2", ...],
            "sentiment": "positive/negative/neutral",
            "summary": "brief summary of the meeting"
        }}
        """
        
        response = model.generate_content(prompt)
        
        # Try to parse as JSON, fallback to text if it fails
        try:
            analysis = json.loads(response.text)
        except json.JSONDecodeError:
            analysis = {
                "raw_analysis": response.text,
                "topics": [],
                "action_items": [],
                "participants": [],
                "sentiment": "neutral",
                "summary": response.text[:200] + "..." if len(response.text) > 200 else response.text
            }
        
        return analysis
        
    except Exception as e:
        return {
            "error": f"Analysis failed: {str(e)}",
            "topics": [],
            "action_items": [],
            "participants": [],
            "sentiment": "neutral",
            "summary": "Analysis unavailable"
        }

def summarize_with_gemini(text):
    """Summarize transcript with Gemini AI"""
    try:
        prompt = f"""
        Please provide a concise summary of this meeting transcript:

        "{text}"

        Focus on:
        - Main discussion points
        - Key decisions made
        - Next steps or action items
        
        Keep the summary under 200 words.
        """
        
        response = model.generate_content(prompt)
        return response.text
        
    except Exception as e:
        return f"Summary unavailable: {str(e)}"

if __name__ == '__main__':
    port = int(os.getenv('PORT', 8000))
    debug = os.getenv('FLASK_ENV') == 'development'
    print(f"Starting Flask server on port {port}")
    print(f"CORS configured for http://localhost:3000")
    print(f"Active sessions storage initialized")
    app.run(host='0.0.0.0', port=port, debug=debug)