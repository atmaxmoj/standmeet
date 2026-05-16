class AssetNotFound(Exception):
    def __init__(self, path: str):
        self.path = path
        super().__init__(f"Asset not found: {path}")


class InvalidAssetPath(Exception):
    def __init__(self, path: str, reason: str = ""):
        self.path = path
        super().__init__(f"Invalid asset path '{path}': {reason}")


class AssetAlreadyExists(Exception):
    def __init__(self, path: str):
        self.path = path
        super().__init__(f"Asset already exists: {path}")
