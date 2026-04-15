chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (
      message.type ===
      "VALIDATE_LICENSE"
    ) {
      fetch(
        "https://69d863c9002525524342.sgp.appwrite.run/",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            action: "validate",
            token: message.token,
            deviceId: message.deviceId,
          }),
        },
      )
        .then((res) => res.json())
        .then((data) => {
          if (
            data &&
            data.usageLimit !==
              undefined
          ) {
            chrome.storage.local.set({
              "fb-usage-limit":
                data.usageLimit,
            });
          }
          sendResponse({
            success: true,
            data,
          });
        })
        .catch((err) =>
          sendResponse({
            success: false,
            error: err.toString(),
          }),
        );
      return true; // keep alive for async
    }

    if (
      message.type === "DECREMENT_USAGE"
    ) {
      chrome.storage.local
        .get([
          "fb-app-token",
          "fb-device-id",
        ])
        .then((res) => {
          fetch(
            "https://69d863c9002525524342.sgp.appwrite.run/",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                action: "decrement",
                token:
                  res["fb-app-token"],
                deviceId:
                  res["fb-device-id"],
              }),
            },
          )
            .then((res) => res.json())
            .then((data) => {
              if (
                data &&
                data.usageLimit !==
                  undefined
              ) {
                chrome.storage.local.set(
                  {
                    "fb-usage-limit":
                      data.usageLimit,
                  },
                );
              }
              sendResponse({
                success: true,
                data,
              });
            })
            .catch((err) =>
              sendResponse({
                success: false,
                error: err.toString(),
              }),
            );
        });

      return true;
    }
  },
);
