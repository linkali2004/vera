import express from "express";
import {
  applyCloudinaryWatermark,
  handleTagAudioUpload,
  handleTagImageUpload,
  handleTagMixedUpload,
  handleTagVideoUpload,
} from "../middleware/tagUpload.js";
import {
  createTag,
  deleteTag,
  getAllTags,
  getPopularTags,
  getTagByHash,
  getTagById,
  getTagsByUser,
  likeTag,
  updateTag,
} from "./controller.js";

const router = express.Router();

// POST /api/tags - Create a new tag (JSON only)
router.post("/", createTag);

// POST /api/tags/with-images - Create tag with image uploads
router.post("/with-images", handleTagImageUpload("images", 10), createTag);

// POST /api/tags/with-videos - Create tag with video uploads
router.post("/with-videos", handleTagVideoUpload("videos", 10), createTag);

// POST /api/tags/with-audio - Create tag with audio uploads
router.post("/with-audio", handleTagAudioUpload("audio", 10), createTag);

// POST /api/tags/with-media - Create tag with mixed media uploads
router.post("/with-media", handleTagMixedUpload(), createTag);

// GET /api/tags - Get all tags with pagination and filtering
router.get("/", getAllTags);

// GET /api/tags/popular - Get popular tags
router.get("/popular", getPopularTags);

// GET /api/tags/:id - Get tag by ID
router.get("/:id", getTagById);

// GET /api/tags/hash/:hash_address - Get tag by hash address
router.get("/hash/:hash_address", getTagByHash);

// GET /api/tags/user/:address - Get tags by user address
router.get("/user/:address", getTagsByUser);

// PUT /api/tags/:id - Update tag (JSON only)
router.put("/:id", updateTag);

// PUT /api/tags/:id/images - Update tag with new images
router.put("/:id/images", handleTagImageUpload("images", 10), updateTag);

// PUT /api/tags/:id/videos - Update tag with new videos
router.put("/:id/videos", handleTagVideoUpload("videos", 10), updateTag);

// PUT /api/tags/:id/audio - Update tag with new audio
router.put("/:id/audio", handleTagAudioUpload("audio", 10), updateTag);

// PUT /api/tags/:id/media - Update tag with mixed media
router.put("/:id/media", handleTagMixedUpload(), updateTag);

// POST /api/tags/:id/like - Like a tag
router.post("/:id/like", likeTag);

// DELETE /api/tags/:id - Delete tag
router.delete("/:id", deleteTag);

router.post("/watermark", applyCloudinaryWatermark);

export default router;