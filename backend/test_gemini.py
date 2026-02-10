import asyncio
import sounddevice as sd
import numpy as np
import websockets
import json
import base64
import os
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class GeminiLiveClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.websocket = None
        self.sample_rate = 16000  # Gemini Live API supports 16kHz
        self.connected = False
        
    async def connect(self, model: str = "gemini-2.0-flash-exp"):
        """Connect to Gemini Live API via WebSocket"""
        # WebSocket endpoint for Gemini Live API
        uri = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={self.api_key}"
        
        try:
            self.websocket = await websockets.connect(uri)
            self.connected = True
            
            # Configure the session with speech coaching instructions
            setup_message = {
                "setup": {
                    "model": f"models/{model}",
                    "generation_config": {
                        "response_modalities": ["TEXT"],  # Focus on text feedback for detailed analysis
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {
                                    "voice_name": "Aoede"
                                }
                            }
                        }
                    },
                    "system_instruction": {
                        "parts": [{
                            "text": """You are an expert speech coach and communication analyst. Your role is to:

1. **ANALYZE SPEAKING PATTERNS**: Listen carefully to the user's voice and analyze:
   - Tone of voice (confident, hesitant, monotone, energetic, etc.)
   - Speaking pace (too fast, too slow, just right)
   - Vocal variety (inflection, emphasis, rhythm)
   - Clarity and articulation
   - Filler words (um, uh, like, you know)
   - Pauses and timing
   - Emotional undertones

2. **EVALUATE WORD CHOICES**: Examine their:
   - Vocabulary sophistication
   - Precision of language
   - Clarity of expression
   - Use of jargon or overly complex terms
   - Conciseness vs. verbosity

3. **PROVIDE CONSTRUCTIVE FEEDBACK**: After each audio input, give:
   - 2-3 specific observations about their speaking style
   - 1-2 concrete suggestions for improvement
   - One strength to reinforce
   - Overall speaking assessment (scale of 1-10)

4. **FORMAT YOUR RESPONSE** like this:
   📊 **SPEAKING ANALYSIS**
   
   🎯 **What I Observed:**
   - [Specific observation about tone/delivery]
   - [Observation about word choice/clarity]
   - [Observation about pacing/flow]
   
   💡 **Suggestions for Improvement:**
   - [Specific actionable tip]
   - [Another concrete suggestion]
   
   ✨ **What You Did Well:**
   - [Positive reinforcement]
   
   📈 **Overall Score:** X/10
   
   🗣️ **Quick Tip:** [One-sentence practical advice]

Be encouraging but honest. Focus on practical, actionable advice they can implement immediately."""
                        }]
                    }
                }
            }
            
            await self.websocket.send(json.dumps(setup_message))
            print("🔗 Connected to Gemini Live API")
            
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            self.connected = False
            
    async def send_audio_chunk(self, audio_data: np.ndarray):
        """Send audio data to Gemini"""
        if not self.connected or not self.websocket:
            return
            
        try:
            # Convert float32 to int16 PCM
            pcm_data = (audio_data * 32767).astype(np.int16)
            audio_base64 = base64.b64encode(pcm_data.tobytes()).decode()
            
            message = {
                "realtime_input": {
                    "media_chunks": [{
                        "mime_type": "audio/pcm",
                        "data": audio_base64
                    }]
                }
            }
            
            await self.websocket.send(json.dumps(message))
            
        except Exception as e:
            print(f"❌ Error sending audio: {e}")
    
    async def send_text(self, text: str):
        """Send text message to Gemini"""
        if not self.connected or not self.websocket:
            return
            
        try:
            message = {
                "client_content": {
                    "turns": [{
                        "role": "user",
                        "parts": [{
                            "text": text
                        }]
                    }],
                    "turn_complete": True
                }
            }
            
            await self.websocket.send(json.dumps(message))
            print(f"💬 Sent: {text}")
            
        except Exception as e:
            print(f"❌ Error sending text: {e}")
    
    async def listen_for_responses(self):
        """Listen for responses from Gemini"""
        if not self.connected or not self.websocket:
            return
            
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    
                    # Handle different response types
                    if "serverContent" in data:
                        server_content = data["serverContent"]
                        
                        if "modelTurn" in server_content:
                            model_turn = server_content["modelTurn"]
                            
                            # Handle text responses
                            if "parts" in model_turn:
                                for part in model_turn["parts"]:
                                    if "text" in part:
                                        print(f"🤖 Gemini: {part['text']}")
                                    elif "inlineData" in part:
                                        # Handle audio responses
                                        print("🎵 Received audio response")
                                        # You could decode and play the audio here
                                        
                    elif "setupComplete" in data:
                        print("✅ Setup complete - ready for interaction")
                        
                    elif "error" in data:
                        print(f"❌ API Error: {data['error']}")
                        
                except json.JSONDecodeError:
                    print(f"❌ Failed to parse message: {message}")
                    
        except Exception as e:
            print(f"❌ Error listening for responses: {e}")
    
    async def disconnect(self):
        """Disconnect from the API"""
        if self.websocket:
            await self.websocket.close()
            self.connected = False
            print("👋 Disconnected from Gemini Live API")

class AudioStreamer:
    def __init__(self, client: GeminiLiveClient):
        self.client = client
        self.audio_buffer = []
        self.buffer_size = 1600  # ~100ms at 16kHz
        self.is_recording = False
        self.loop = None  # Store the event loop reference
        self.recording_session = 0  # Track recording sessions for feedback
        
    def audio_callback(self, indata, frames, time, status):
        """Audio input callback"""
        if status:
            print(f"Audio status: {status}")
            
        if not self.is_recording or not self.loop:
            return
            
        # Convert to mono
        mono_data = indata[:, 0] if len(indata.shape) > 1 else indata
        self.audio_buffer.extend(mono_data)
        
        # Send audio in chunks
        while len(self.audio_buffer) >= self.buffer_size:
            chunk = np.array(self.audio_buffer[:self.buffer_size])
            self.audio_buffer = self.audio_buffer[self.buffer_size:]
            
            # Send audio chunk asynchronously using the stored loop reference
            asyncio.run_coroutine_threadsafe(
                self.client.send_audio_chunk(chunk),
                self.loop
            )
    
    def start_recording(self):
        """Start recording audio"""
        self.is_recording = True
        self.recording_session += 1
        print(f"🎤 Recording session #{self.recording_session} started...")
        print("💡 Speak naturally - I'm analyzing your tone, pace, and word choices!")
    
    def stop_recording(self):
        """Stop recording audio"""
        if self.is_recording:
            self.is_recording = False
            print("⏹️ Recording stopped - analyzing your speech...")
            print("⏳ Please wait for detailed feedback...")
        else:
            print("❌ Not currently recording")
    
    async def request_speech_analysis(self):
        """Request a comprehensive speech analysis"""
        analysis_prompt = """Please provide a comprehensive analysis of my overall speaking patterns based on all the audio you've heard from me so far. Include:

1. Consistent patterns you've noticed across multiple recordings
2. My strongest speaking qualities
3. Areas that need the most improvement
4. Specific exercises or techniques I should practice
5. Progress tracking suggestions

Please be detailed and actionable in your feedback."""
        
        await self.client.send_text(analysis_prompt)
        print("📊 Requesting comprehensive speech analysis...")
    
    async def start_streaming(self):
        """Start audio streaming with speech coaching commands"""
        # Store the current event loop for the audio callback
        self.loop = asyncio.get_running_loop()
        
        print("🎯 SPEECH COACH MODE ACTIVATED!")
        print("=" * 50)
        print("I'll analyze your speaking style and help you improve!")
        print("")
        print("📝 COMMANDS:")
        print("  's' + Enter = Start recording speech sample")
        print("  'x' + Enter = Stop recording & get feedback") 
        print("  'a' + Enter = Get comprehensive analysis")
        print("  't' + Enter = Send text message")
        print("  'q' + Enter = Quit")
        print("")
        print("💡 TIP: Try recording different types of speech:")
        print("   - Casual conversation")
        print("   - Formal presentation")
        print("   - Explaining something complex")
        print("   - Telling a story")
        print("=" * 50)
        
        # Start listening for responses
        response_task = asyncio.create_task(self.client.listen_for_responses())
        
        with sd.InputStream(
            channels=1,
            samplerate=self.client.sample_rate,
            dtype=np.float32,
            callback=self.audio_callback
        ):
            try:
                while True:
                    command = await asyncio.get_event_loop().run_in_executor(
                        None, input, "\n📱 Enter command: "
                    )
                    
                    if command.lower() == 's':
                        if not self.is_recording:
                            self.start_recording()
                        else:
                            print("❌ Already recording! Use 'x' to stop first.")
                    elif command.lower() == 'x':
                        self.stop_recording()
                    elif command.lower() == 'a':
                        await self.request_speech_analysis()
                    elif command.lower() == 't':
                        text = await asyncio.get_event_loop().run_in_executor(
                            None, input, "💬 Enter text: "
                        )
                        await self.client.send_text(text)
                    elif command.lower() == 'q':
                        if self.is_recording:
                            self.stop_recording()
                        print("👋 Thanks for practicing! Keep working on your speaking skills!")
                        break
                    else:
                        print("❌ Unknown command. Use: s, x, a, t, or q")
                        
            except KeyboardInterrupt:
                print("\n👋 Stopping speech coaching session...")
            finally:
                response_task.cancel()
                await self.client.disconnect()

async def main():
    # Get API key from .env file
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ Please set your GOOGLE_API_KEY in your .env file")
        print("   Create a .env file with: GOOGLE_API_KEY=your_api_key_here")
        print("   You can get an API key at: https://aistudio.google.com/apikey")
        return
    
    # Create client and connect
    client = GeminiLiveClient(api_key)
    await client.connect()
    
    if not client.connected:
        return
    
    # Start streaming
    streamer = AudioStreamer(client)
    await streamer.start_streaming()

if __name__ == "__main__":
    asyncio.run(main())