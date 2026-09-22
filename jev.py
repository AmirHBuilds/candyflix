import requests

API_KEY = "apikey_2112e38a447491c74328a6dc0c88b09303e4_bb6bfd0d76a00db83c753829335bc0c46b0c8ac816a45ecaedba0f749ee82c83"

url = "https://api.typesafe.ai/v1/systemone"

payload = {
    "model": "jev-latest",
    "state": """
    A customer says their payment was charged twice.
    They need the duplicate charge refunded today because they
    have an upcoming bill.
    """,
    "questions": {
        "department": {
            "type": "choice",
            "instructions": "Which team should handle this ticket?",
            "criteria": {
                "billing": "Payment, refund, or duplicate-charge issue",
                "technical": "Software, login, or technical problem",
                "general": "General customer support"
            }
        },
        "urgent": {
            "type": "noul",
            "instructions": "Is the customer explicitly requesting urgent action?",
            "criteria": {
                "true": "The customer explicitly needs action today",
                "false": "No immediate deadline is expressed"
            }
        }
    }
}

response = requests.post(
    url,
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json=payload,
)

print(response.status_code)
print(response.json())