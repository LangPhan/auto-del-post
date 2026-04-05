import axios from "axios";

const api = axios.create({
  baseURL: 'https://www.facebook.com/api/graphql/'
})

export default api