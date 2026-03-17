import os

def list_files(startpath, exclude_dirs=None):
    if exclude_dirs is None:
        exclude_dirs = ['.git', '.vscode', 'Lib', 'share', 'node_modules']
    
    for root, dirs, files in os.walk(startpath):
        # Filter out directories to exclude
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        
        # Calculate depth to format the tree-like structure
        depth = root.replace(startpath, '').count(os.sep)
        indent = ' ' * 4 * depth  # Each level is indented by 4 spaces
        print(f"{indent}{os.path.basename(root)}/")  # Print folder name
        
        subindent = ' ' * 4 * (depth + 1)
        for f in files:
            print(f"{subindent}{f}")  # Print file name indented by 4 spaces more

# Set the path to your folder
startpath = r"F:\iceland-quake-monitoring"
list_files(startpath)