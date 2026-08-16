import pandas as pd

file_path = "data/raw/prgi_001.csv"

df = pd.read_csv(file_path)

print(df.head())
print(df.columns)
print("Number of rows:", len(df))