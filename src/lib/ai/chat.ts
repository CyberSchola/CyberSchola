// import type { NextApiRequest, NextApiResponse } from "next";
// import { runAiChat, AiServiceError } from "@/lib/ai";
// import type { AiChatResponse } from "@/lib/ai";

// export default async function handler(
//   req: NextApiRequest,
//   res: NextApiResponse<AiChatResponse>
// ) {
//   if (req.method !== "POST") {
//     res.setHeader("Allow", "POST");
//     return res.status(405).json({
//       success: false,
//       error: {
//         code: "METHOD_NOT_ALLOWED",
//         message: "Only POST requests are allowed",
//       },
//     });
//   }

//   try {
//     const result = await runAiChat(req.body);

//     return res.status(200).json({
//       success: true,
//       data: result,
//     });
//   } catch (error) {
//     if (error instanceof AiServiceError) {
//       return res.status(error.status).json({
//         success: false,
//         error: {
//           code: error.code,
//           message: error.message,
//         },
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       error: {
//         code: "INTERNAL_ERROR",
//         message: "Something went wrong",
//       },
//     });
//   }
// }