# DDoS Login Test - One-Liner Version
# Führe aus: ./ddos-login-test.sh [server-url] [concurrent] [total]

# Beispiel für localhost:
# ./ddos-login-test.sh http://localhost:3000 5 50

# Beispiel für Produktionsserver:
# ./ddos-login-test.sh https://your-server.com 10 200

# Oder direkt mit curl (einfache Version):
# for i in {1..50}; do curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"hacker$i\",\"password\":\"wrongpass$i\"}" & done; wait

# Mit Rate Limiting Test:
# for i in {1..100}; do curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"test\",\"password\":\"test\"}" -w "%{http_code}\n" | grep -q "401" && echo "Attempt $i: OK" || echo "Attempt $i: BLOCKED"; sleep 0.1; done