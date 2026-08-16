import pandas as pd

file_path = "data/raw/prgi_001.csv"

df = pd.read_csv(file_path)

print("\nFIRST 5 ROWS:")
print(df.head())

print("\nCOLUMN NAMES:")
print(df.columns.tolist())

print("\nNUMBER OF ROWS:")
print(len(df))