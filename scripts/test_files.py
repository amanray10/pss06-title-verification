import pandas as pd
import glob

# Find all CSV files inside data/raw
files = glob.glob("data/raw/*.csv")

print("Files found:")
print(files)

# Create an empty list
dataframes = []

# Read each CSV file
for file in files:
    df = pd.read_csv(file)
    dataframes.append(df)

print("Number of files:", len(dataframes))

# Show the first file's data
print(dataframes[0].head())

combined_df = pd.concat(dataframes, ignore_index=True)

print("\nCombined data:")
print(combined_df.head())

print("\nTotal rows:")
print(len(combined_df))

print("\nTotal columns:")
print(len(combined_df.columns))