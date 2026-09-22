$json = @'
{"roomId":"fbu-bkv0-dog","senderId":"user-001","senderName":"Alice","text":"Hello World!"}
'@
$json = $json.Trim()
Write-Host "Publishing: $json"
docker exec redis redis-cli PUBLISH chat-message $json
