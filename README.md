# ai-trip-planner-agent
AI Agent / Full-stack application

# ✈️ AI Trip Planner Agent

An AI-powered travel planning application that helps users plan their trips with the assistance of multiple AI agents. It gathers flight information, researches hotels, and generates personalized travel itineraries based on user requirements.

## 🌍 Project Overview

The **AI Trip Planner Agent** is built using Python, FastAPI, LangGraph, and Groq LLMs. It uses a multi-agent workflow to simplify travel planning.

Users can enter a natural-language request, such as:

> Plan a 3-day trip to Tokyo from Bangladesh.

The application processes the request through different agents and generates a structured travel plan.

## ✨ Features

- 🤖 **AI-Powered Travel Planning:** Generate personalized travel itineraries.
- ✈️ **Flight Information:** Search for flight information using the AviationStack API.
- 🏨 **Hotel Research:** Find hotel information using Tavily Search.
- 🧠 **Multi-Agent Architecture:** Coordinate multiple agents using LangGraph.
- 💬 **Natural Language Input:** Describe your travel plans in plain English.
- 🌐 **Web Interface:** Interact with the application through a frontend built with HTML, CSS, and JavaScript.
- 🗄️ **Conversation Memory:** Use PostgreSQL and LangGraph checkpointing to persist agent state.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Python | Backend development |
| FastAPI | Web framework and API |
| LangGraph | Multi-agent workflow |
| LangChain | LLM integration |
| Groq | AI model inference |
| Tavily API | Web search and hotel research |
| AviationStack API | Flight information |
| PostgreSQL | Persistent conversation storage |
| HTML, CSS, JavaScript | Frontend |
| Docker | Containerization |

## 📁 Project Structure

```text
ai-trip-planner-agent/
│
├── app.py
├── backend.py
├── requirements.txt
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── README.md
│
├── static/
│   ├── style.css
│   └── script.js
│
├── templates/
│   └── index.html
│
└── tools/
    ├── flight_tool.py
    └── tavily_tool.py
```

## ⚙️ Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/ai-trip-planner-agent.git
```

Navigate to the project directory:

```bash
cd ai-trip-planner-agent
```

### 2. Create a Virtual Environment

```bash
python -m venv .venv
```

Activate it on Windows:

```powershell
.\.venv\Scripts\Activate.ps1
```

Activate it on macOS/Linux:

```bash
source .venv/bin/activate
```

### 3. Install Dependencies

```bash
python -m pip install -r requirements.txt
```

### 4. Configure Environment Variables

Create a `.env` file in the project root directory.

Add your API credentials:

```env
GROQ_API_KEY=your_groq_api_key
TAVILY_API_KEY=your_tavily_api_key
AVIATIONSTACK_API_KEY=your_aviationstack_api_key
DATABASE_URL=your_postgresql_connection_url
```

**API services:**

- Groq: https://console.groq.com/
- Tavily: https://tavily.com/
- AviationStack: https://aviationstack.com/
- PostgreSQL: https://render.com/

Replace the placeholder values with your own credentials.

**Security:** Never upload your `.env` file or expose API keys and database credentials in your public repository.

### 5. Run the Application

Start the FastAPI application:

```bash
python app.py
```

Alternatively, if your `app.py` does not start Uvicorn itself:

```bash
uvicorn app:app --reload
```

Open the application in your browser:

```text
http://127.0.0.1:8000
```

Use the port displayed in your terminal if it is different.

## 🚀 Example Usage

Enter a travel request into the application:

```text
Plan a 3-day trip to Tokyo from Bangladesh.
```

The AI agents will:

1. Analyze the user's travel request.
2. Search for relevant flight information.
3. Research hotels and accommodation options.
4. Generate a personalized travel itinerary.
5. Present the final travel plan.

## 🐳 Docker

Docker support can be used to package and run the application in a container.

Once the Dockerfile is configured, build the image:

```bash
docker build -t ai-trip-planner-agent .
```

Run the container:

```bash
docker run -p 8000:8000 --env-file .env ai-trip-planner-agent
```

Make sure your Dockerfile starts the FastAPI application and your environment variables are configured.

## 🔮 Future Improvements

- Integration with flight booking and ticket-pricing APIs.
- Real-time hotel pricing and availability.
- Interactive maps and travel routes.
- Budget estimation and expense tracking.
- User authentication and profile management.
- Multi-language travel planning.
- Cloud deployment and production monitoring.

## 🤝 Contributing

Contributions are welcome!

1. Fork this repository.
2. Create a new feature branch.
3. Commit your changes.
4. Push your branch.
5. Open a Pull Request.

## 📄 License

This project is available for educational and development purposes. Add a LICENSE file to specify the terms under which others may use, modify, and distribute this project.

## 👨‍💻 Author

**Your Name**

GitHub: https://github.com/michealsujan

---

⭐ If you find this project useful, consider giving the repository a star!