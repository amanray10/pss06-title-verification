import os, mysql.connector
from dotenv import load_dotenv
load_dotenv()
c = mysql.connector.connect(host="localhost", user=os.getenv("MYSQL_USER","root"), password=os.getenv("MYSQL_PASSWORD",""), database="prgi")
cur = c.cursor()
cur.execute("UPDATE users SET email=%s WHERE id=%s", ("ray10aman@gmail.com", "usr_admin_01"))
c.commit()
cur.execute("SELECT id, email FROM users")
for row in cur.fetchall(): print(row)