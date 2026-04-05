import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

export const apiClient = axios.create({
  baseURL,
  timeout: 60_000,
  headers: {
    Accept: "application/json",
  },
});
