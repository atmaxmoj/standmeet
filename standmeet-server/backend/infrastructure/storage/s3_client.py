from __future__ import annotations

import logging

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from django.conf import settings

from domain.asset.storage import AssetStorage

logger = logging.getLogger(__name__)


class MinioAssetStorage(AssetStorage):
    def __init__(self):
        self._bucket = settings.S3_BUCKET_NAME
        # Internal client for actual S3 operations
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
        )
        # Public client for generating presigned URLs accessible from outside Docker
        self._public_client = boto3.client(
            "s3",
            endpoint_url=settings.S3_PUBLIC_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
        )

    def _key(self, path: str) -> str:
        return path.lstrip("/")

    def ensure_bucket(self) -> None:
        try:
            self._client.head_bucket(Bucket=self._bucket)
            logger.info("Bucket '%s' already exists", self._bucket)
        except ClientError:
            self._client.create_bucket(Bucket=self._bucket)
            logger.info("Created bucket '%s'", self._bucket)

        # Set public-read policy so pages can be served without signing
        import json
        policy = {
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": "*",
                "Action": "s3:GetObject",
                "Resource": f"arn:aws:s3:::{self._bucket}/pages/*",
            }],
        }
        self._client.put_bucket_policy(
            Bucket=self._bucket,
            Policy=json.dumps(policy),
        )
        logger.info("Set public-read policy on bucket '%s' for pages/*", self._bucket)

    def upload(self, path: str, data: bytes, mime_type: str) -> None:
        self._client.put_object(
            Bucket=self._bucket,
            Key=self._key(path),
            Body=data,
            ContentType=mime_type,
        )

    def delete(self, path: str) -> None:
        self._client.delete_object(
            Bucket=self._bucket,
            Key=self._key(path),
        )

    def presigned_url(self, path: str, expires_in: int = 3600) -> str:
        return self._public_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": self._key(path)},
            ExpiresIn=expires_in,
        )

    def exists(self, path: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=self._key(path))
            return True
        except ClientError:
            return False
