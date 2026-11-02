from tools.tavily_tool import tavily_search
from tools.flight_tool import search_flights
from backend import run_travel_agent

res = tavily_search("Best hotels in India")
print(res)
print("\n\n")
res = search_flights("New York to London on 2023-12-25")
print(res)