# SSH DDoS Login Test - One-Liner Versionen für VM Testing

# 1. Einfache Version mit ssh-keyscan + falschen Passwörtern (funktioniert ohne Zusatztools)
for i in {1..30}; do ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 -o PasswordAuthentication=yes root@localhost "echo test" 2>/dev/null || echo "Failed login $i"; done

# 2. Mit expect (falls installiert: apt install expect)
# expect -c "
#   for {set i 1} {\$i <= 30} {incr i} {
#     spawn ssh -o StrictHostKeyChecking=no root@localhost
#     expect {
#       \"password:\" { send \"wrongpass\$i\r\"; exp_continue }
#       \"yes/no\" { send \"yes\r\"; exp_continue }
#       eof
#     }
#   }
# "

# 3. Mit sshpass (falls installiert: apt install sshpass)
# for i in {1..30}; do sshpass -p "wrongpass$i" ssh -o StrictHostKeyChecking=no root@localhost "echo test" 2>/dev/null || echo "Failed login $i"; done

# 4. Aggressive Version (mehr parallele Verbindungen)
# for i in {1..50}; do
#   (ssh -o StrictHostKeyChecking=no -o ConnectTimeout=2 root@localhost "echo test" 2>/dev/null || echo "Failed $i") &
# done; wait

# Nach dem Test prüfen:
# - tail -f /var/log/auth.log (auf der VM)
# - VMMaintainer Security Events (high severity erwartet)
# - Agent logs für Detection