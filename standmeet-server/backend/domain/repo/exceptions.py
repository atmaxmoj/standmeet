class ContentNotFound(Exception):
    def __init__(self, path: str):
        self.path = path
        super().__init__(f"Content not found: {path}")


class InvalidPath(Exception):
    def __init__(self, path: str, reason: str = ""):
        self.path = path
        super().__init__(f"Invalid path '{path}': {reason}")
